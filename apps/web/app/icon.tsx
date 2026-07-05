import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

// Tiny SVG favicon — reuses the 3D Pazzera emblem at 32×32
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
          background: 'linear-gradient(135deg,#14141F 0%,#0a0a12 100%)',
          borderRadius: '8px',
          position: 'relative',
          fontSize: '20px',
          fontWeight: '900',
          color: 'white',
        }}
      >
        {/* Bars */}
        <div
          style={{
            position: 'absolute',
            left: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5px',
          }}
        >
          <div style={{ width: '2px', height: '5px', background: 'white', borderRadius: '1px' }} />
          <div style={{ width: '2px', height: '10px', background: 'white', borderRadius: '1px' }} />
          <div style={{ width: '2px', height: '14px', background: 'white', borderRadius: '1px' }} />
          <div style={{ width: '2px', height: '7px', background: 'white', borderRadius: '1px' }} />
        </div>
        {/* Mountain */}
        <div
          style={{
            position: 'absolute',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: 0,
            height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '12px solid #00F5E1',
            filter: 'drop-shadow(0 0 2px #7B5EFF)',
          }}
        />
      </div>
    ),
    { ...size },
  );
}