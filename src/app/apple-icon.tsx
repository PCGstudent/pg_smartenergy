import { ImageResponse } from 'next/og'

/**
 * Apple touch icon — required for iOS "Add to Home Screen" to look polished
 * AND for iOS 16.4+ Web Push to work (iOS only delivers push notifications
 * to apps installed via Share → Add to Home Screen).
 *
 * Next 15 auto-injects `<link rel="apple-touch-icon">` for this file.
 */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          // Apple recomputes corner radii server-side, but a baked-in radius
          // keeps it nice if the OS ever skips its own mask.
          borderRadius: 36,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 192 192" fill="none">
          <defs>
            <linearGradient id="bolt-ios" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5cf09a" />
              <stop offset="100%" stopColor="#34c97e" />
            </linearGradient>
          </defs>
          <path
            d="M111 28 L58 112 H92 V164 L138 84 H102 Z"
            fill="url(#bolt-ios)"
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
