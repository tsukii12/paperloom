/** 品牌标:纸页层叠 + 顶层一道织线(呼应「织译」)。无底板,随 text-* 取色。 */
export default function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 5 26.6 11 16 17 5.4 11Z" fill="currentColor" fillOpacity=".16" />
        <path d="M5.4 16.1 16 22.1l10.6-6" />
        <path d="M5.4 21.2 16 27.2l10.6-6" />
      </g>
    </svg>
  )
}
