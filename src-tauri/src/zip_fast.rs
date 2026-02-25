//! Minimal ZIP reader optimized for large archives (3GB+, 5000+ entries).
//!
//! Unlike `zip::ZipArchive::new()` which validates every local file header on open
//! (causing thousands of random seeks), this parser only reads the End of Central
//! Directory + Central Directory — a single sequential read of ~1MB from the end
//! of the file. Individual entries are read on demand.
//!
//! Uses memory-mapped I/O for zero-copy access.

use std::io::Read;
use std::path::Path;

use memmap2::Mmap;

/// Metadata for a single ZIP entry, parsed from the Central Directory.
struct EntryMeta {
    name: String,
    compression_method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

/// Fast ZIP reader that only parses the Central Directory on open.
pub struct ZipIndex {
    mmap: Mmap,
    entries: Vec<EntryMeta>,
}

// ── helper readers ──────────────────────────────────────────────────

#[inline]
fn r16(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}

#[inline]
fn r32(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}

#[inline]
fn r64(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes([
        d[o],
        d[o + 1],
        d[o + 2],
        d[o + 3],
        d[o + 4],
        d[o + 5],
        d[o + 6],
        d[o + 7],
    ])
}

// ── signatures ──────────────────────────────────────────────────────

const EOCD_SIG: u32 = 0x06054b50;
const EOCD64_LOC_SIG: u32 = 0x07064b50;
const EOCD64_SIG: u32 = 0x06064b50;
const CD_SIG: u32 = 0x02014b50;
const LOCAL_SIG: u32 = 0x04034b50;

impl ZipIndex {
    /// Open a ZIP file: mmap + parse Central Directory only.
    /// This is the fast path — no local file header validation.
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let file = std::fs::File::open(path)?;
        // SAFETY: Read-only access; file is not modified while mapped.
        let mmap = unsafe { Mmap::map(&file)? };
        let data = &mmap[..];

        if data.len() < 22 {
            anyhow::bail!("File too small to be a ZIP archive");
        }

        let eocd_pos =
            Self::find_eocd(data).ok_or_else(|| anyhow::anyhow!("EOCD record not found"))?;

        let (num_entries, cd_offset) = Self::parse_eocd(data, eocd_pos)?;
        let entries = Self::parse_cd(data, cd_offset as usize, num_entries as usize)?;

        Ok(Self { mmap, entries })
    }

    /// Iterator over all entry names (files and directories).
    pub fn entry_names(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|e| e.name.as_str())
    }

    /// Read and decompress an entry by name.
    pub fn read_entry(&self, name: &str) -> anyhow::Result<Vec<u8>> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| anyhow::anyhow!("ZIP entry not found: {}", name))?;
        self.decompress(entry)
    }

    // ── internal ────────────────────────────────────────────────────

    fn decompress(&self, entry: &EntryMeta) -> anyhow::Result<Vec<u8>> {
        let data = &self.mmap[..];
        let lh = entry.local_header_offset as usize;

        if lh + 30 > data.len() {
            anyhow::bail!("Local header offset out of bounds");
        }
        if r32(data, lh) != LOCAL_SIG {
            anyhow::bail!("Invalid local file header signature");
        }

        let name_len = r16(data, lh + 26) as usize;
        let extra_len = r16(data, lh + 28) as usize;
        let data_start = lh + 30 + name_len + extra_len;
        let data_end = data_start + entry.compressed_size as usize;

        if data_end > data.len() {
            anyhow::bail!("Compressed data extends beyond file");
        }

        let compressed = &data[data_start..data_end];

        match entry.compression_method {
            0 => {
                // Stored — no compression
                Ok(compressed.to_vec())
            }
            8 => {
                // Deflate
                let mut decoder = flate2::read::DeflateDecoder::new(compressed);
                let mut buf = Vec::with_capacity(entry.uncompressed_size as usize);
                decoder.read_to_end(&mut buf)?;
                Ok(buf)
            }
            m => anyhow::bail!("Unsupported compression method: {}", m),
        }
    }

    /// Scan backwards from end of file for EOCD signature.
    fn find_eocd(data: &[u8]) -> Option<usize> {
        let search_len = std::cmp::min(data.len(), 22 + 65535);
        let start = data.len() - search_len;
        for i in (start..=data.len().saturating_sub(22)).rev() {
            if r32(data, i) == EOCD_SIG {
                return Some(i);
            }
        }
        None
    }

    /// Parse EOCD (+ ZIP64 if present). Returns (num_entries, cd_offset).
    fn parse_eocd(data: &[u8], eocd_pos: usize) -> anyhow::Result<(u64, u64)> {
        let num16 = r16(data, eocd_pos + 10) as u64;
        let off32 = r32(data, eocd_pos + 16) as u64;

        // Try ZIP64 EOCD Locator (immediately before EOCD)
        if eocd_pos >= 20 {
            let loc = eocd_pos - 20;
            if r32(data, loc) == EOCD64_LOC_SIG {
                let eocd64_off = r64(data, loc + 8) as usize;
                if eocd64_off + 56 <= data.len() && r32(data, eocd64_off) == EOCD64_SIG {
                    let n = r64(data, eocd64_off + 32);
                    let o = r64(data, eocd64_off + 48);
                    return Ok((n, o));
                }
            }
        }

        Ok((num16, off32))
    }

    /// Parse Central Directory entries sequentially.
    /// Handles non-UTF-8 filenames (e.g. EUC-KR, Shift-JIS) via chardetng auto-detection.
    fn parse_cd(
        data: &[u8],
        cd_offset: usize,
        num_entries: usize,
    ) -> anyhow::Result<Vec<EntryMeta>> {
        // First pass: collect raw entries with name bytes
        struct RawEntry {
            compression_method: u16,
            compressed_size: u64,
            uncompressed_size: u64,
            local_header_offset: u64,
            name_bytes: Vec<u8>,
            is_utf8_flag: bool,
        }

        let mut raw_entries = Vec::with_capacity(num_entries);
        let mut pos = cd_offset;

        for _ in 0..num_entries {
            if pos + 46 > data.len() {
                break;
            }
            if r32(data, pos) != CD_SIG {
                break;
            }

            let flags = r16(data, pos + 8);
            let is_utf8_flag = (flags & (1 << 11)) != 0;
            let method = r16(data, pos + 10);
            let c32 = r32(data, pos + 20) as u64;
            let u32_ = r32(data, pos + 24) as u64;
            let name_len = r16(data, pos + 28) as usize;
            let extra_len = r16(data, pos + 30) as usize;
            let comment_len = r16(data, pos + 32) as usize;
            let off32 = r32(data, pos + 42) as u64;

            let name_end = pos + 46 + name_len;
            if name_end > data.len() {
                break;
            }

            let name_bytes = data[pos + 46..name_end].to_vec();

            let mut compressed = c32;
            let mut uncompressed = u32_;
            let mut offset = off32;

            // ZIP64 extended information extra field
            if c32 == 0xFFFF_FFFF || u32_ == 0xFFFF_FFFF || off32 == 0xFFFF_FFFF {
                let extra_end = name_end + extra_len;
                if extra_end <= data.len() {
                    Self::read_zip64_extra(
                        &data[name_end..extra_end],
                        u32_,
                        &mut uncompressed,
                        c32,
                        &mut compressed,
                        off32,
                        &mut offset,
                    );
                }
            }

            raw_entries.push(RawEntry {
                compression_method: method,
                compressed_size: compressed,
                uncompressed_size: uncompressed,
                local_header_offset: offset,
                name_bytes,
                is_utf8_flag,
            });

            pos = name_end + extra_len + comment_len;
        }

        // Detect encoding for non-UTF-8 filenames
        let mut detector = chardetng::EncodingDetector::new();
        let mut has_non_utf8 = false;
        for entry in &raw_entries {
            if !entry.is_utf8_flag && std::str::from_utf8(&entry.name_bytes).is_err() {
                detector.feed(&entry.name_bytes, false);
                has_non_utf8 = true;
            }
        }
        let detected_encoding = if has_non_utf8 {
            detector.feed(&[], true);
            detector.guess(None, true)
        } else {
            encoding_rs::UTF_8
        };

        // Build final entries with properly decoded names
        let entries = raw_entries
            .into_iter()
            .map(|raw| {
                let name = if raw.is_utf8_flag
                    || std::str::from_utf8(&raw.name_bytes).is_ok()
                {
                    String::from_utf8_lossy(&raw.name_bytes).to_string()
                } else {
                    let (decoded, _, _) = detected_encoding.decode(&raw.name_bytes);
                    decoded.to_string()
                };
                EntryMeta {
                    name,
                    compression_method: raw.compression_method,
                    compressed_size: raw.compressed_size,
                    uncompressed_size: raw.uncompressed_size,
                    local_header_offset: raw.local_header_offset,
                }
            })
            .collect();

        Ok(entries)
    }

    fn read_zip64_extra(
        extra: &[u8],
        u32_val: u64,
        uncompressed: &mut u64,
        c32_val: u64,
        compressed: &mut u64,
        off32_val: u64,
        offset: &mut u64,
    ) {
        let mut p = 0;
        while p + 4 <= extra.len() {
            let id = u16::from_le_bytes([extra[p], extra[p + 1]]);
            let sz = u16::from_le_bytes([extra[p + 2], extra[p + 3]]) as usize;
            if id == 0x0001 {
                let mut fp = p + 4;
                if u32_val == 0xFFFF_FFFF && fp + 8 <= p + 4 + sz {
                    *uncompressed = u64::from_le_bytes([
                        extra[fp],
                        extra[fp + 1],
                        extra[fp + 2],
                        extra[fp + 3],
                        extra[fp + 4],
                        extra[fp + 5],
                        extra[fp + 6],
                        extra[fp + 7],
                    ]);
                    fp += 8;
                }
                if c32_val == 0xFFFF_FFFF && fp + 8 <= p + 4 + sz {
                    *compressed = u64::from_le_bytes([
                        extra[fp],
                        extra[fp + 1],
                        extra[fp + 2],
                        extra[fp + 3],
                        extra[fp + 4],
                        extra[fp + 5],
                        extra[fp + 6],
                        extra[fp + 7],
                    ]);
                    fp += 8;
                }
                if off32_val == 0xFFFF_FFFF && fp + 8 <= p + 4 + sz {
                    *offset = u64::from_le_bytes([
                        extra[fp],
                        extra[fp + 1],
                        extra[fp + 2],
                        extra[fp + 3],
                        extra[fp + 4],
                        extra[fp + 5],
                        extra[fp + 6],
                        extra[fp + 7],
                    ]);
                }
                break;
            }
            p += 4 + sz;
        }
    }
}
