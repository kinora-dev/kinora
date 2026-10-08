export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`
}

// Polar amounts are in cents and can be fractions of one (a $0.004 unit price).
export function money(cents: number, currency: string): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const longDateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Compact date + time in the viewer's locale, for rows and tooltips (e.g. "Oct 7, 05:51 PM").
export function formatDateTime(date: string | Date): string {
  return dateTimeFmt.format(new Date(date))
}

// Same with the weekday, for a page's main timestamp (e.g. "Wed, Oct 7, 05:51 PM").
export function formatDateTimeLong(date: string | Date): string {
  return longDateTimeFmt.format(new Date(date))
}
