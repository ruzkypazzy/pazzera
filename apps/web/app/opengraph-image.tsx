import { ImageResponse } from 'next/og';

export const alt = 'Pazzera — pay once, every time you listen';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0a12',
          padding: '64px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: 'linear-gradient(135deg,#7B5EFF,#00F5E1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 36,
              fontWeight: 900,
              color: 'white',
            }}
          >
            P
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginLeft: 20,
            }}
          >
            <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: 'white' }}>
              PAZZERA
            </div>
            <div style={{ display: 'flex', fontSize: 14, color: 'rgba(255,255,255,0.55)' }}>
              Pay · Play · Stream
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 78,
              fontWeight: 900,
              color: 'white',
              lineHeight: 1.05,
            }}
          >
            Pay once. Every time.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              color: 'rgba(255,255,255,0.7)',
              maxWidth: 720,
              marginTop: 16,
            }}
          >
            Decentralized music streaming where every stream pays artists directly in USDC on Arc.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', fontSize: 18, color: 'rgba(255,255,255,0.55)' }}>
            pazzera.com
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 18px',
              borderRadius: 9999,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 16,
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            Live on Arc Testnet
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}