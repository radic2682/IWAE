import { compareVersions } from './releaseNotes'

/**
 * 안내 둘러보기(coach mark) 자료와 「언제 무엇을 보일지」의 순수 규칙.
 * 글은 한국어가 열쇠이고 화면에서 t() 를 거친다(영어는 src/i18n/en). 본문의 `{prefix}` 는 지금 접두키 키캡으로 바뀐다.
 * 새 버전용 둘러보기를 더하는 법은 docs/design/tours.md.
 */

export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  readonly id: string
  /** `data-tour` 값. 없거나 화면에서 못 찾으면 칸을 가리지 않고 가운데 카드로 보인다 */
  readonly target?: string
  readonly title: string
  readonly body: string
  /** 번역이 이미 켜져 있으면 본문 대신 이 글을 보인다 */
  readonly bodyWhenTranslationOn?: string
  readonly placement?: TourPlacement
  /** true 면 목표를 못 찾을 때 가운데 카드로 보이지 않고 이 단계를 건너뛴다(처음 설치처럼 작업 공간이 비어 있을 수 있는 단계) */
  readonly optional?: boolean
  /** 이 단계에 오면 이 종류의 첫 칸을 먼저 만진다(도구줄 · 서식바는 만지는 칸 것만 나온다) */
  readonly focus?: TourFocus
}

/** 둘러보기가 먼저 만져 줄 칸의 종류: 문서(PDF · Markdown) 칸, 노트 칸 */
export type TourFocus = 'pdf' | 'note'

export interface Tour {
  readonly id: string
  readonly kind: 'onboarding' | 'feature'
  /** 새 기능 둘러보기: 이 안내가 처음 들어간 릴리스 버전('v' 없이 0.2.0) */
  readonly version?: string
  /** 팔레트·메뉴에 보이는 이름(한국어 열쇠) */
  readonly name: string
  readonly steps: readonly TourStep[]
}

export const ONBOARDING_TOUR_ID = 'onboarding'

export const TOURS: readonly Tour[] = [
  {
    id: ONBOARDING_TOUR_ID,
    kind: 'onboarding',
    name: '처음 사용 안내',
    steps: [
      { id: 'welcome', title: 'IWAE 처음 사용 안내', body: 'PDF를 읽으며 남긴 형광펜과 메모를 노트로 엮는 앱입니다. 처음 연 Vault에는 안내서 PDF와 예시 노트가 나란히 열려 있습니다.' },
      { id: 'sidebar-docs', target: 'sidebar-docs', title: '문서 열기', body: '문서를 누르면 탭으로 열립니다. 노트는 바로 아래 목록에서 엽니다.', placement: 'right' },
      { id: 'pdf-highlight', target: 'pdf-highlight', optional: true, title: '형광펜 칠하기', body: '글을 고르고 색을 누르면 형광펜이 칠해집니다. 같은 색 채널의 노트 칸에 메모가 생깁니다.', placement: 'right' },
      { id: 'memo-card', target: 'memo-card', optional: true, title: '메모 카드', body: '카드를 누르면 PDF가 그 문장으로 이동합니다. 카드 안에 바로 글을 쓸 수 있습니다.', placement: 'left' },
      { id: 'channel-dot', target: 'channel-dot', title: '색 채널', body: '같은 색 칸끼리 연동됩니다. 색 점을 다른 칸으로 끌면 두 칸이 이어집니다.', placement: 'bottom' },
      { id: 'region-capture', target: 'region-capture', optional: true, focus: 'pdf', title: '영역 캡처', body: '표나 그림을 네모로 잡으면 메모가 됩니다. PDF 칸을 고르면 이 단추가 맨 위 줄에 나옵니다.', placement: 'bottom' },
      { id: 'format-bar', target: 'format-bar', optional: true, focus: 'note', title: '서식바', body: '노트 칸을 고르면 맨 위 줄에 서식바가 나옵니다. 왼쪽 손잡이를 끌면 어디든 띄워 둘 수 있습니다.', placement: 'bottom' },
      { id: 'pane-head', target: 'pane-head', title: '칸 나누기와 옮기기', body: '탭을 칸 가장자리로 끌면 칸이 나뉩니다. 칸 머리를 끌면 칸을 옮기거나 바꾸고, 탭을 창 밖으로 끌면 새 창이 됩니다.', placement: 'bottom' },
      { id: 'screen-tabs', target: 'screen-tabs', title: '화면과 접두키', body: '{prefix}를 누른 다음 {k:%}, {k:"}로 칸을 나누고 {k:c}로 새 화면을 만듭니다. {prefix} 다음 {k:?}를 누르면 키 목록이 나옵니다.', placement: 'bottom' },
      { id: 'sidebar-search', target: 'sidebar-search', title: '검색', body: '왼쪽 바의 검색 탭에서 모든 문서와 노트를 한꺼번에 찾습니다.', placement: 'bottom' },
      { id: 'app-menu', target: 'app-menu', title: '메뉴와 명령 팔레트', body: '로고 메뉴와 명령 팔레트({k:Ctrl+K})에서 모든 명령을 찾습니다. 이 안내도 여기서 다시 볼 수 있습니다.', placement: 'bottom' },
      { id: 'translator', target: 'translator', title: '번역기', body: '고른 글을 번역합니다. 설정에서 번역을 켜면 쓸 수 있습니다.', bodyWhenTranslationOn: '고른 글을 번역합니다. 글을 고른 뒤 이 단추로 번역기를 엽니다.', placement: 'bottom' },
      { id: 'finish', title: '시작하기', body: '안내서 PDF의 「해 보기」 상자를 따라 하면 메모와 캡처를 직접 익힐 수 있습니다. 설정에서 테마, 단축키, 번역을 바꿉니다.' },
    ],
  },
  {
    id: 'v0.2.0',
    kind: 'feature',
    version: '0.2.0',
    name: '새 기능 둘러보기',
    steps: [
      { id: 'welcome', title: 'v0.2.0 새 기능', body: '작업 공간이 칸 단위로 바뀌었습니다. 달라진 점을 둘러봅니다.' },
      { id: 'toolbar', target: 'toolbar', title: '도구줄이 맨 위로', body: '아래 상태 줄이 없어지고, 선택한 칸의 도구가 맨 위 줄에 나옵니다.', placement: 'bottom' },
      { id: 'pane-head', target: 'pane-head', title: '칸 끌기', body: '칸 머리를 끌어 옮기거나 자리를 바꿉니다. 탭을 창 밖으로 끌면 새 창으로 분리됩니다.', placement: 'bottom' },
      { id: 'channel-dot', target: 'channel-dot', title: '색 점 잇기', body: '색 점을 다른 칸으로 끌면 두 칸이 같은 색으로 이어집니다.', placement: 'bottom' },
      { id: 'screen-tabs', target: 'screen-tabs', title: '화면과 접두키', body: '{prefix} 다음 {k:%}, {k:"}로 칸을 나누고 {k:c}로 새 화면을 만듭니다. {prefix} 다음 {k:?}로 키 목록을 봅니다.', placement: 'bottom' },
      { id: 'note-pane', target: 'note-pane', title: '메모 옮기기', body: '메모를 다른 노트로 끌어 옮깁니다. {k:Alt}를 누른 채 놓으면 링크가 생깁니다.', placement: 'left' },
      { id: 'translator', target: 'translator', title: '번역기 창', body: '번역기는 탭이 아니라 앱 위에 뜨는 창입니다. 맨 위 줄 단추로 엽니다.', placement: 'bottom' },
    ],
  },
]

/**
 * 실제로 보일 단계의 차례(steps 안의 번호). optional 이 아닌 단계는 늘 보이고,
 * optional 단계는 isPresent 가 true 일 때만 보인다. 진행 표시(n / 전체)와 이전 · 다음이 같은 목록을 쓴다.
 */
export function shownStepIndexes(steps: readonly TourStep[], isPresent: (step: TourStep) => boolean): readonly number[] {
  const shown: number[] = []
  steps.forEach((step, index) => { if (step.optional !== true || isPresent(step)) shown.push(index) })
  return shown
}

export function tourById(id: string, tours: readonly Tour[] = TOURS): Tour | undefined {
  return tours.find((tour) => tour.id === id)
}

/** 가장 새 버전의 새 기능 둘러보기(팔레트 「새 기능 둘러보기」) */
export function latestFeatureTour(tours: readonly Tour[] = TOURS): Tour | undefined {
  return featureTours(tours).at(-1)
}

/** 새 기능 둘러보기를 버전 오름차순으로 */
function featureTours(tours: readonly Tour[]): readonly Tour[] {
  return tours
    .filter((tour) => tour.kind === 'feature' && tour.version !== undefined)
    .sort((a, b) => compareVersions(a.version ?? '', b.version ?? ''))
}

export interface TourPlanInput {
  /** 마지막으로 시작한 앱 버전(`iwae:last-seen-version:v1`). 없으면 null */
  readonly lastSeenVersion: string | null
  readonly currentVersion: string
  /** 이미 본(또는 미룬) 둘러보기 id */
  readonly seen: readonly string[]
  /** 이 앱을 전에 쓴 흔적이 있는가(마지막 버전 기록이 없어도 쓰던 사람일 수 있다) */
  readonly hasExistingInstall: boolean
  readonly tours?: readonly Tour[]
}

export interface TourPlan {
  /** 저절로 보일 둘러보기 id, 순서대로 */
  readonly run: readonly string[]
  /** 보이지 않고 본 것으로 적어 둘 id(처음 설치에서 지난 새 기능 안내) */
  readonly markSeen: readonly string[]
}

const VERSION_SHAPE = /^v?\d+\.\d+\.\d+/u

/**
 * 시작할 때 무엇을 보일지.
 * - 처음 설치(마지막 버전 기록도, 쓴 흔적도 없음): 처음 사용 안내만. 지금 버전까지의 새 기능 안내는 본 것으로 친다.
 * - 업데이트: 마지막 버전 뒤 ~ 지금 버전 사이에 들어간 새 기능 안내 중 안 본 것(오래된 것 먼저). 쓰던 사람에게 처음 사용 안내를 저절로 보이지 않는다.
 * - 그 밖(같은 버전·내림)은 없다.
 */
export function planTours({ lastSeenVersion, currentVersion, seen, hasExistingInstall, tours = TOURS }: TourPlanInput): TourPlan {
  const features = featureTours(tours).filter((tour) => compareVersions(tour.version ?? '', currentVersion) <= 0)
  const hasLast = lastSeenVersion !== null && VERSION_SHAPE.test(lastSeenVersion.trim())
  if (!hasLast && !hasExistingInstall) {
    const onboarding = tours.find((tour) => tour.kind === 'onboarding')
    return {
      run: onboarding === undefined || seen.includes(onboarding.id) ? [] : [onboarding.id],
      markSeen: features.filter((tour) => !seen.includes(tour.id)).map((tour) => tour.id),
    }
  }
  const from = hasLast && lastSeenVersion !== null ? lastSeenVersion : '0.0.0'
  const run = features
    .filter((tour) => compareVersions(tour.version ?? '', from) > 0 && !seen.includes(tour.id))
    .map((tour) => tour.id)
  return { run, markSeen: [] }
}
