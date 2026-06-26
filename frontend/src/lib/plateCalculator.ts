const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]

export interface PlateResult {
  weight: number
  count: number
}

export function calculatePlates(targetKg: number, barKg: number): PlateResult[] {
  let remaining = Math.max(0, (targetKg - barKg) / 2)
  const result: PlateResult[] = []
  for (const plate of PLATES_KG) {
    const count = Math.floor(remaining / plate)
    if (count > 0) {
      result.push({ weight: plate, count })
      remaining -= count * plate
      remaining = Math.round(remaining * 1000) / 1000
    }
  }
  return result
}
