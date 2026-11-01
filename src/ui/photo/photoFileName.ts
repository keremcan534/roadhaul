/** A picture's file name from when it was taken (the device's local time): `roadhaul-20261101-153012.jpg`. */
export function photoFileName(takenAt: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  const day = `${takenAt.getFullYear()}${two(takenAt.getMonth() + 1)}${two(takenAt.getDate())}`;
  const time = `${two(takenAt.getHours())}${two(takenAt.getMinutes())}${two(takenAt.getSeconds())}`;
  return `roadhaul-${day}-${time}.jpg`;
}
