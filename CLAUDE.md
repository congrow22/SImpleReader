# CLAUDE.md - SImpleReader

## 기술 스택

- **Framework**: Tauri 2.x (Rust 백엔드 + WebView 프론트엔드)
- **Backend**: Rust (2021 edition)
- **Frontend**: Vanilla JS
- **Package Manager**: pnpm (프론트엔드), Cargo (Rust)
- **핵심 크레이트**: ropey (대용량 텍스트 처리)

## 개발 환경

```bash
# 개발 서버 실행 (핫 리로드)
pnpm tauri dev

# 프로덕션 빌드
pnpm tauri build

# Rust 코드만 체크
cd src-tauri && cargo check

# Rust 테스트
cd src-tauri && cargo test

# Rust 포맷팅
cd src-tauri && cargo fmt

# Rust 린트
cd src-tauri && cargo clippy
```

## 프로젝트 구조

```
SImpleReader/
├── src/                    # 프론트엔드 소스
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── src-tauri/              # Rust 백엔드
│   ├── src/
│   │   ├── main.rs         # 진입점
│   │   ├── lib.rs          # 라이브러리 루트
│   │   ├── commands/       # Tauri 커맨드
│   │   ├── config.rs       # 설정 관리
│   │   └── error.rs        # 에러 타입
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                   # 문서 (Obsidian 심볼릭 링크)
└── package.json
```

## Rust 코딩 규칙

- **에러 처리**: `anyhow::Result` 사용 (라이브러리는 `thiserror`)
- **직렬화**: `serde` derive 매크로 사용
- **네이밍**: snake_case (함수/변수), PascalCase (타입/구조체)
- **모듈**: 기능별로 분리, `mod.rs`에서 pub export

## Tauri 커맨드 작성 규칙

```rust
// commands/file.rs
use tauri::command;

#[command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())
}
```

- 커맨드는 `commands/` 폴더에 기능별로 분리
- `#[command]` 매크로 필수
- 에러는 `Result<T, String>` 형태로 반환
- 비동기 작업은 `async` 사용

## 프론트엔드 → Rust 호출

```javascript
const { invoke } = window.__TAURI__.core;

const content = await invoke('read_text_file', { path: '/path/to/file' });
```

## 응답 언어

- **모든 답변은 한국어로 작성**
- 코드 주석도 한국어 가능
- 변수명/함수명은 영어 유지

## Git 커밋 정책

- **커밋은 사용자의 명시적 지시가 있을 때만 수행**
- 코드 변경 후 자동으로 커밋하지 않음
- 커밋 메시지는 한국어 사용 가능

## 문서 인덱스

| 파일 | 설명 |
|------|------|
| docs/service-overview.md | 서비스 개요, 아키텍처 다이어그램 |
| docs/architecture.md | Rust 모듈 구조, 데이터 흐름 |
| docs/error.md | 에러 사례 및 해결 방법 |
| docs/작업일지.md | 작업 기록 |

## 빌드 & 배포

```bash
# Windows 설치파일 생성
pnpm tauri build

# 결과물 위치
# src-tauri/target/release/bundle/nsis/SImpleReader_{version}_x64-setup.exe
```
