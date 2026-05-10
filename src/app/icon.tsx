import { ImageResponse } from 'next/og'

/**
 * Generated favicon — Next 15 routes this to `/icon` and serves a 512x512 PNG.
 * The same JSX is reused by `apple-icon.tsx` at 180x180, keeping the brand mark
 * pixel-consistent across browser tabs, Android home screens, and macOS docks.
 */
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0c 0%, #1c1d20 100%)',
          borderRadius: 96,
          position: 'relative',
        }}
      >
        {/* Soft electric glow behind the bolt */}
        <div
          style={{
            position: 'absolute',
            width: 360,
            height: 360,
            borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(92,240,154,0.30) 0%, rgba(92,240,154,0) 70%)',
          }}
        />
        <svg width="320" height="320" viewBox="0 0 192 192" fill="none">
          <defs>
            <linearGradient id="bolt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5cf09a" />
              <stop offset="100%" stopColor="#34c97e" />
            </linearGradient>
          </defs>
          <path
            d="M111 28 L58 112 H92 V164 L138 84 H102 Z"
            fill="url(#bolt)"
            stroke="#5cf09a"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  )
}
