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
  readonly placement?: TourPlacement
}

export interface Tour {
  readonly id: string
  readonly kind: 'onboarding' | 'feature'
  /** 새 기능 둘러보기: 이 안내가 처음 들어간 릴리스 버전('v' 없이 0.1.20) */
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
      { id: 'welcome', title: 'IWAE 처음 사용 안내', body: 'PDF를 읽으며 남긴 형광펜과 메모를 노트로 엮는 앱입니다. 주요 화면을 차례로 둘러봅니다.' },
      { id: 'sidebar-tabs', target: 'sidebar-tabs', title: '왼쪽 바', body: '문서와 노트 목록, 목차, 쪽 미리보기, PDF 도구, 검색을 오갑니다.', placement: 'bottom' },
      { id: 'sidebar-docs', target: 'sidebar-docs', title: '문서 열기', body: '문서를 누르면 탭으로 열립니다. 탭을 칸 가장자리로 끌면 칸이 나뉩니다.', placement: 'right' },
      { id: 'pane-head', target: 'pane-head', title: '칸', body: '칸마다 색 점, 번호, 탭 줄이 있습니다. 머리를 끌어 칸을 옮기거나 자리를 바꿉니다.', placement: 'bottom' },
      { id: 'toolbar', target: 'toolbar', title: '도구줄', body: '선택한 칸의 도구가 맨 위 줄에 나옵니다.', placement: 'bottom' },
      { id: 'channel-dot', target: 'channel-dot', title: '색 채널', body: '같은 색 칸끼리 연동됩니다. 글을 칠하면 같은 색 노트 칸에 메모가 생기고 선으로 이어집니다.', placement: 'bottom' },
      { id: 'screen-tabs', target: 'screen-tabs', title: '화면과 접두키', body: '{prefix}를 누른 다음 %를 누르면 칸을 좌우로 나눕니다. {prefix} 다음 ?를 누르면 키 목록이 나옵니다.', placement: 'bottom' },
      { id: 'app-menu', target: 'app-menu', title: '명령 팔레트', body: 'Ctrl+K로 모든 명령을 찾습니다. 이 안내는 명령 팔레트의 「처음 사용 안내」로 다시 볼 수 있습니다.', placement: 'bottom' },
      { id: 'translator', target: 'translator', title: '번역기', body: '고른 글을 번역합니다. 설정에서 번역을 켜면 쓸 수 있습니다.', placement: 'bottom' },
    ],
  },
  {
    id: 'v0.1.20',
    kind: 'feature',
    version: '0.1.20',
    name: '새 기능 둘러보기',
    steps: [
      { id: 'welcome', title: 'v0.1.20 새 기능', body: '작업 공간이 칸 단위로 바뀌었습니다. 달라진 점을 둘러봅니다.' },
      { id: 'toolbar', target: 'toolbar', title: '도구줄이 맨 위로', body: '아래 상태 줄이 없어지고, 선택한 칸의 도구가 맨 위 줄에 나옵니다.', placement: 'bottom' },
      { id: 'pane-head', target: 'pane-head', title: '칸 끌기', body: '칸 머리를 끌어 옮기거나 자리를 바꿉니다. 탭을 창 밖으로 끌면 새 창으로 분리됩니다.', placement: 'bottom' },
      { id: 'channel-dot', target: 'channel-dot', title: '색 점 잇기', body: '색 점을 다른 칸으로 끌면 두 칸이 같은 색으로 이어집니다.', placement: 'bottom' },
      { id: 'screen-tabs', target: 'screen-tabs', title: '화면과 접두키', body: '{prefix} 다음 %, "로 칸을 나누고 c로 새 화면을 만듭니다. {prefix} 다음 ?로 키 목록을 봅니다.', placement: 'bottom' },
      { id: 'note-pane', target: 'note-pane', title: '메모 옮기기', body: '메모를 다른 노트로 끌어 옮깁니다. Alt를 누른 채 놓으면 링크가 생깁니다.', placement: 'left' },
      { id: 'translator', target: 'translator', title: '번역기 창', body: '번역기는 탭이 아니라 앱 위에 뜨는 창입니다. 맨 위 줄 단추로 엽니다.', placement: 'bottom' },
    ],
  },
]

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
