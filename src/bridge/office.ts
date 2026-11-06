/** PowerPoint(.ppt/.pptx) → PDF. PC 에 깔린 PowerPoint 로 바꾼다(Rust office_to_pdf). 몇 초 걸린다 */
export async function officeToPdf(source: string, target: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('office_to_pdf', { source, target })
}

export function isPowerPointPath(path: string): boolean {
  return /\.pptx?$/iu.test(path)
}
