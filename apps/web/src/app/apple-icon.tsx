import { ImageResponse } from 'next/og'

/** The home-screen icon of an iPhone, which takes no SVG: `icon.svg`, drawn as a PNG. */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#143D2B',
      }}
    >
      <svg width="132" height="132" viewBox="12 14 40 40" xmlns="http://www.w3.org/2000/svg">
        <title>Messagerie</title>
        <path
          d="M20 16h24a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H32l-10 8v-8h-2a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7z"
          fill="#D9F5B5"
        />
        <rect x="22" y="28" width="20" height="5" rx="2.5" fill="#72CA89" />
      </svg>
    </div>,
    size,
  )
}
