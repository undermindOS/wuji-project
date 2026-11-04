export default function BrandMark() {
  return (
    <div className="flex items-center" style={{ gap: '1px' }}>
      <div className="text-center leading-none">
        <div className="font-display text-[28px] tracking-[0.02em] whitespace-nowrap">
          <span className="text-phosphor">WU</span>
          <span style={{ color: '#FF3333' }}>JI</span>
        </div>
        <div className="font-mono text-[28px] text-white">
          <span className="text-crt text-[32px] leading-none">(</span>
          <span className="tracking-[0.06em]">無極</span>
          <span className="text-crt text-[32px] leading-none">)</span>
        </div>
      </div>
      <img
        src="/images/logo-head-mouth.png"
        alt="WU JI"
        className="w-20 h-20 relative -top-3"
        style={{ marginLeft: '-10px', imageRendering: 'pixelated' }}
      />
    </div>
  );
}
