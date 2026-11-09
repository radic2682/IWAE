# TODO (논의 후 진행)

- [ ] 오른쪽 노트 열: 노트를 문서와 상관없이 창 맨 오른쪽에 늘 하나 둔다(빈 화면에서도 노트를 열면 오른쪽 바가 열림, 창을 나눠도 오른쪽). PDF·Markdown 메모 바를 앱 전체 하나로 합친다.
- [ ] 노트 접고 펼치기 기능 다시 설계
- [ ] 라이브러리 펼치기: 왼쪽 바 모양·펼치기 단추 자리를 유지한 채 넓어지게
- [ ] 노트 펼치기(메모만 보기) 디자인 개편: 다른 화면과 같은 모양으로
- [ ] PDF 화면 나누기: 노트에서 먼 칸(사이에 다른 칸)의 형광펜 연결선을 어떻게 이을지

## PDF 편집 기능 후보 (Stirling-PDF 도구 목록 대비, 2026-11-09)

이미 있음: 쪽 순서·회전·빼기·다른 PDF 쪽 끼워 넣기(쪽 편집), 검색 가능한 PDF 사본(OCR), 형광펜을 PDF 주석으로 넣어 내보내기, 글 상자·펜·선·도형(덮개 층), 버전 나란히 비교, 스캔 영역 OCR.

추천 높음
- [ ] 두 판 글자 비교(compare): 버전 묶음의 두 PDF 를 문단 단위로 비교해 바뀐 곳 표시(스펙 개정판)
- [ ] PDF 합치기(merge) · 쪽 뽑아 새 PDF(extractPages/split) · 목차 단위로 나누기(splitByChapters)
- [ ] 내 표시 굽기(flatten/annotate): 글 상자·펜·도형·박스 메모까지 PDF 사본에 넣어 공유
- [ ] 가리기(redact): 고른 글·영역을 지운 사본(공유 전 개인정보 제거)
- [ ] 암호 PDF 열기(removePassword): 지금은 열지 못한다고만 알림

추천 중간
- [ ] 압축(compress) · 빈 쪽 빼기(removeBlanks) · 스캔 쪽 자동 회전(autoRotate)
- [ ] IWAE 목차·책갈피를 PDF 목차로 쓰기(editTableOfContents)
- [ ] 쪽 번호·도장·그림·워터마크 넣기(addPageNumbers/addStamp/addImage/watermark)
- [ ] 쪽 자르기·크기 맞추기(crop/scalePages) · 모아찍기(pageLayout/booklet)
- [ ] PDF → 이미지·Markdown 글로 내보내기(convert/extractImages)

하지 않음(앱 성격과 다름): 서버·자동화 파이프라인, 인증서 서명·검증, 양식 자동 감지, PDF 본문 글자 직접 고치기, JavaScript 보기
