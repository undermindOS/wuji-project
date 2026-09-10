export default function Footer() {
  return (
    <footer
      className="relative w-full py-[4vh] md:py-[6vh]"
      style={{
        background: '#000000',
        borderTop: '1px solid #1A1A1A',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        {/* Bottom bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <span className="font-data text-[11px] text-crt">
            © 2026 Liberon.Tech by Grupo KhD
          </span>

          <span className="font-data text-[12px] text-gridline hidden md:block">
            ·-·-·-·-·-·-·-·-·-·-·-·-·
          </span>

          <span className="font-data text-[11px] text-crt">
            BUILT_FOR_THE_AI_CENTURY
          </span>
        </div>
      </div>
    </footer>
  );
}
