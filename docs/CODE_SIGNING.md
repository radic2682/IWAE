# 코드 서명 안내 (소유자가 준비할 것)

IWAE 설치 파일은 지금 **코드 서명이 없습니다**. 그래서 Windows 는 설치 때 SmartScreen 경고(「Windows 의 PC 보호」)를, macOS 는 「개발자를 확인할 수 없음」 경고를 띄웁니다. 이 문서는 소유자가 무엇을 사고, 어디에 어떤 값을 넣어야 서명이 되는지 정리합니다.

> **가격과 정책은 자주 바뀝니다.** 아래 금액·조건은 작성자가 아는 시점(2026년 중반까지)의 것입니다. 사기 전에 반드시 링크의 공식 페이지에서 다시 확인하세요.

## 먼저 알아 둘 것

- **서명은 두 종류입니다.** (1) 운영체제용 서명(Windows Authenticode, macOS Developer ID + 공증)은 경고를 줄이는 것입니다. (2) 자동 업데이트용 minisign 서명(`TAURI_SIGNING_PRIVATE_KEY`)은 **이미 쓰고 있고** 이 문서와 별개입니다. 둘을 섞지 마세요. 업데이트용 키를 잃으면 기존 설치본이 새 업데이트를 받을 수 없으니 백업 위치(G: 드라이브 등)를 유지하세요.
- **서명해도 SmartScreen 경고가 바로 사라지지는 않을 수 있습니다.** Microsoft 는 평판(받는 사람 수)을 함께 봅니다. 예전에는 EV 인증서가 평판을 즉시 주었지만, 지금은 그렇지 않다는 보고가 많습니다(공식 정책을 확인하세요). 서명은 「게시자 확인됨」을 보이게 하고, 시간이 지나며 경고가 줄어듭니다.
- 서명하지 않아도 IWAE 는 동작합니다. 공개 초기에는 FAQ 의 안내(`docs/FAQ.md`)로 버티고, 사용자가 늘면 서명하는 순서도 합리적입니다.

## Windows

### 선택지 비교

| 방법 | 대략 비용 | 장점 | 주의 |
| --- | --- | --- | --- |
| **Azure Trusted Signing** (최근 Artifact Signing 으로 이름이 바뀌는 중) | 기본 월 약 US$9.99(월 5,000건) | 가장 싼 정식 경로. 인증서를 직접 보관하지 않고 클라우드에서 서명. 단기 인증서가 자동으로 돌아 갱신 걱정이 없음 | **가입 가능 지역·자격이 제한됩니다.** 제가 아는 바로 법인은 미국·캐나다·EU·영국, 개인은 미국·캐나다 중심이고 **한국은 대상이 아니었습니다.** 지금도 그런지 확인 필요. 신원 확인(법인은 사업 이력 요건 등)에 시간이 걸림 |
| **OV 코드 서명 인증서** (Sectigo, DigiCert, SSL.com, Certum 등 판매) | 연 약 US$200~450 (판매처·기간에 따라 다름) | 개인·법인 모두 가능, 한국에서도 구매 가능 | 2023년 6월부터 개인 키를 **하드웨어(USB 토큰 또는 클라우드 HSM)** 에 둬야 함. 최대 유효기간이 줄어드는 중(2026년 3월부터 약 460일 상한)이라 매년 갱신. 평판은 쌓아야 함 |
| **EV 코드 서명 인증서** | 연 약 US$300~700 | 신원 검증이 가장 엄격해 신뢰가 높음 | 법인 중심(개인 EV 는 판매처 따라 제한). 위 OV 와 같은 하드웨어 요건. 평판 즉시 부여는 더 이상 기대하지 말 것 |
| **Certum 오픈 소스 코드 서명** | 연 약 €30~70 + 토큰/클라우드 카드 비용 | 오픈 소스 개발자용 저가 상품. 개인도 가능 | 서명 시 「Open Source Developer, 이름」으로 표시. 토큰 배송·리더 설정이 번거롭고 CI 자동화가 어려움 |
| **SignPath Foundation** (오픈 소스 무료 프로그램) | 무료 | 공개 오픈 소스 프로젝트에 인증서와 서명 서비스를 제공 | 저장소가 **공개**이고 **GitHub Actions 같은 CI 에서 빌드**해야 하며(원격 증명), 이 PC 에서 `release-local` 로 빌드하는 현재 흐름과 맞지 않음. 승인 심사 필요 |

추천 순서(소유자 상황에 따라): 한국 거주 개인이면 (1) SignPath Foundation 신청 가능 여부 확인(공개 후), (2) Azure 가 지원되는지 확인, (3) 안 되면 OV 인증서. 비용 대비 효과가 확실한 것은 사용자가 늘어난 뒤입니다.

### 인증서를 사면 해야 할 일

1. 판매처가 요구하는 신원 확인을 끝냅니다(개인: 신분증·영상 통화 등, 법인: 사업자 등록 증빙). 며칠~몇 주 걸립니다.
2. 개인 키를 하드웨어에 받습니다(토큰 배송 또는 클라우드 서명). 키 파일을 **저장소 안에 두지 마세요.**
3. 서명 도구를 정합니다.
   - USB 토큰/스마트 카드: Windows SDK 의 `signtool.exe` 가 인증서 지문(thumbprint)으로 서명합니다. 서명 때 토큰 PIN 입력이 필요해 완전 무인 실행은 어렵습니다.
   - Azure Trusted Signing: `trusted-signing-cli`(또는 Azure 의 서명 도구)가 Azure 계정으로 서명합니다.
   - 클라우드 서명(SSL.com eSigner 등): 판매처가 주는 CLI 를 씁니다.

### tauri.conf.json 에 연결하기

Tauri 2 는 `bundle.windows.signCommand` 로 서명 명령을 부릅니다. `%1` 자리에 서명할 파일 경로가 들어갑니다. 실행 파일(`IWAE.exe`)과 NSIS·MSI 설치 파일 모두에 호출됩니다.

지문으로 `signtool` 을 쓰는 경우(`src-tauri/tauri.conf.json` 의 `bundle.windows`):

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "<인증서 지문>",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

Azure Trusted Signing 같은 외부 도구를 쓰는 경우:

```json
{
  "bundle": {
    "windows": {
      "signCommand": {
        "cmd": "trusted-signing-cli",
        "args": ["-e", "https://<지역>.codesigning.azure.net", "-a", "<계정 이름>", "-c", "<인증서 프로필 이름>", "-d", "IWAE", "%1"]
      }
    }
  }
}
```

권장: 업데이트 설정(`tauri.updater.conf.json`)처럼 **서명용 덮어쓰기 설정을 빌드 때 만들어** 쓰세요. 이 값들은 비밀은 아니지만 이 PC 전용이라 저장소의 `tauri.conf.json` 에 직접 넣지 않는 편이 깔끔합니다.

1. `scripts/write-signing-config.mjs`(새로 만들 것. `write-updater-config.mjs` 를 본뜸)가 환경 변수에서 `src-tauri/tauri.signing.conf.json` 을 씁니다. 이 파일은 `.gitignore` 에 넣습니다.
2. `package.json` 의 `release:build` 가 `tauri build --config src-tauri/tauri.updater.conf.json --config src-tauri/tauri.signing.conf.json` 처럼 두 덮어쓰기를 함께 넘깁니다.
3. `scripts/release-local.mjs` 의 `SECRET_KEYS` 에 서명에 필요한 이름을 더하고(값은 `C:\Workspace\.iwae-release\release.env`), `scripts/release-preflight.mjs` 의 점검에 「서명 설정이 있는가」를 더합니다. 지금은 업데이트 키만 확인합니다.
4. 빌드 뒤 `release-local` 이 설치 파일의 서명을 확인하게 합니다(`Get-AuthenticodeSignature` 의 `Status` 가 `Valid` 인지).

Azure Trusted Signing 에 필요한 환경 변수: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`(서비스 주체), 그리고 엔드포인트·계정 이름·인증서 프로필 이름. 시크릿 값은 `release.env` 에만 두고 로그에 찍지 않습니다(기존 규칙과 같음).

### 같이 챙길 것

- 앱에 함께 들어가는 `pdfium.dll` 은 bblanchon 빌드 그대로라 서명이 없습니다. 설치 파일 전체를 서명하면 경고는 설치 파일 기준으로 뜨지만, 백신 오탐을 줄이려면 같은 인증서로 `pdfium.dll` 도 서명하는 것을 고려하세요(번들 전에 `signtool sign`).
- 타임스탬프 서버를 꼭 쓰세요. 인증서가 만료돼도 서명이 유효하게 남습니다.
- 서명 뒤 설치 파일이 바뀌므로, 업데이트용 `.sig`(minisign)와 `latest.json` 은 **서명한 뒤의 파일** 로 만들어야 합니다. Tauri 가 한 번의 `tauri build` 안에서 순서를 맞춰 줍니다. 서명을 따로 한다면 `.sig` 를 다시 만들어야 합니다.

공식 문서:

- Tauri Windows 서명: https://v2.tauri.app/distribute/sign/windows/
- Azure Trusted Signing: https://learn.microsoft.com/azure/trusted-signing/
- Azure 가격: https://azure.microsoft.com/pricing/details/trusted-signing/
- SignPath Foundation: https://signpath.org/
- Microsoft Defender SmartScreen: https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
- 코드 서명 인증서 요건(CA/Browser Forum): https://cabforum.org/working-groups/code-signing/

## macOS

macOS 에서 경고 없이 열리게 하려면 **Developer ID 서명 + 공증(notarization) + 스테이플**이 모두 필요합니다. Mac 에서 빌드해야 하므로 소유자의 Mac 에서 합니다.

### 사야 할 것

- **Apple Developer Program**: 연 US$99(한국 가격은 원화로 표시되며 연 약 129,000원 안팎, 확인 필요). 개인 또는 조직으로 가입합니다. 조직은 D-U-N-S 번호가 필요하고 심사에 시간이 걸립니다. 한국에서 가입 가능합니다.
  - https://developer.apple.com/programs/

### 만들 것

1. 개발자 계정의 Certificates 에서 **Developer ID Application** 인증서를 만들어 Mac 의 키체인에 설치합니다(CSR 을 Mac 에서 만들어 올림). 인증서 이름은 `Developer ID Application: 이름 (TEAMID)` 형태입니다.
2. 공증용 인증 수단 하나를 만듭니다.
   - 권장: **App Store Connect API 키**(`.p8` 파일, Key ID, Issuer ID). 앱 전용 암호보다 권한을 좁게 줄 수 있습니다.
   - 대안: Apple ID + **앱 암호**(appleid.apple.com 에서 생성) + Team ID.

### 릴리스 스크립트에 필요한 비밀 값

Tauri 가 읽는 환경 변수 이름입니다(`release.env` 같은 저장소 밖 파일에 두고, 로그에 찍지 않습니다).

| 이름 | 내용 |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: 이름 (TEAMID)` |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | 인증서를 `.p12` 로 내보낸 파일의 base64 와 그 암호(CI 에서 쓸 때. 내 Mac 키체인에 이미 설치했다면 생략 가능) |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` | App Store Connect API 키 방식: Issuer ID, Key ID, `.p8` 경로 |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID 방식: 계정, 앱 암호, Team ID (API 키 방식 대신) |

두 공증 방식 중 하나만 있으면 됩니다. `TAURI_SIGNING_PRIVATE_KEY`(업데이트용)는 그대로 필요합니다.

### 설정 바꿀 곳

`src-tauri/tauri.macos.conf.json` 이 지금은 임시 서명(`"signingIdentity": "-"`)에 `"hardenedRuntime": false` 입니다. 공증하려면:

```json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "12.0",
      "signingIdentity": "Developer ID Application: 이름 (TEAMID)",
      "hardenedRuntime": true,
      "entitlements": "entitlements.plist"
    }
  }
}
```

(`signingIdentity` 는 설정 파일 대신 `APPLE_SIGNING_IDENTITY` 환경 변수로 주면 저장소에 이름이 남지 않습니다. 임시 서명용 `-` 는 환경 변수가 없을 때만 쓰도록 하세요.)

- **하드닝된 런타임에서 `libpdfium.dylib`**: 번들에 들어가는 외부 dylib 은 같은 인증서로 서명돼야 로드됩니다. `libpdfium.dylib` 를 번들하기 전에 `codesign --force --options runtime --sign "<identity>" libpdfium.dylib` 로 직접 서명하고, 안 되면 entitlements 에 `com.apple.security.cs.disable-library-validation` 을 더합니다. 이 부분은 **실제 공증 전에 Mac 에서 시험**이 필요합니다(저는 시험하지 못했습니다).
- 웹뷰(WKWebView)는 추가 권한 없이 동작합니다. 공증 후 `spctl -a -vv IWAE.app` 과 `xcrun stapler validate IWAE.app` 으로 확인하세요.

### 공증 흐름

`tauri build` 는 위 환경 변수가 있으면 서명한 뒤 `notarytool` 로 공증하고 스테이플까지 합니다. 손으로 할 때:

```bash
xcrun notarytool submit IWAE.dmg --key AuthKey_XXXX.p8 --key-id <KEY_ID> --issuer <ISSUER_ID> --wait
xcrun stapler staple IWAE.dmg
```

공증은 보통 몇 분 걸리고, 실패하면 `xcrun notarytool log <제출 ID> ...` 로 이유를 봅니다. 업데이트용 `*.app.tar.gz` 는 **공증·스테이플 된 앱** 으로 만든 뒤 minisign 으로 서명해야 합니다(서명 뒤에 앱을 바꾸면 안 됨).

릴리스 스크립트(`release-local.mjs --mac-dir`)는 Mac 산출물만 모읍니다. Mac 쪽 빌드 스크립트(예: `scripts/release-mac.sh`)를 따로 만들어 위 환경 변수를 읽고 `tauri build --target universal-apple-darwin` 을 돌리게 하는 것이 자연스럽습니다.

공식 문서:

- Tauri macOS 서명·공증: https://v2.tauri.app/distribute/sign/macos/
- Apple 공증 개요: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- notarytool: https://developer.apple.com/documentation/security/customizing-the-notarization-workflow
- App Store Connect API 키: https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api

## 체크리스트

- [ ] Windows: 방식 결정(Azure 가능 여부 확인 → SignPath Foundation → OV), 신원 확인, 서명 설정, 설치 파일 서명 확인
- [ ] macOS: Apple Developer Program 가입, Developer ID Application 인증서, 공증용 API 키, `tauri.macos.conf.json` 정리, Mac 에서 공증 시험
- [ ] 비밀 값은 저장소 밖 `release.env` 에만 둔다(백업 위치도 정한다)
- [ ] 서명 후 `README.md` 의 「not notarized」 안내와 `docs/FAQ.md` 의 SmartScreen·Gatekeeper 항목을 갱신한다
