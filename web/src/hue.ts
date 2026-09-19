/** A stable tint per recipe for the photo placeholder. */
export function hue(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
