import "./closed-order.css";

export default function ClosedOrderScreen({ shopName, logo, opening = false, hasOrders, onOpenOrders }) {
  return (
    <main className={`coffee-break${opening ? " is-opening" : ""}`}>
      <section className="coffee-break-panel" aria-labelledby="coffee-break-title">
        <header className="coffee-break-brand">
          {logo}
          <span>{shopName || "ZONE 2 RESERVE BAR"}</span>
        </header>

        <svg className="coffee-break-art" viewBox="0 0 300 240" fill="none" aria-hidden="true">
          <ellipse cx="150" cy="213" rx="106" ry="12" fill="#EAF0EF" />
          <circle cx="145" cy="126" r="89" fill="#F0F5F4" />
          <g stroke="#003B5C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path className="coffee-break-steam steam-one" d="M111 91C96 76 125 68 112 50" stroke="#8DA8AF" />
            <path className="coffee-break-steam steam-two" d="M143 85C126 68 156 56 144 36" stroke="#8DA8AF" />
            <path className="coffee-break-steam steam-three" d="M173 92C159 78 185 69 174 53" stroke="#8DA8AF" />
            <path d="M201 123H212C242 123 241 161 212 165H199" fill="#FAFBF8" />
            <path d="M80 113H204L198 166C196 187 179 200 157 200H128C105 200 88 186 86 166Z" fill="#FAFBF8" />
            <ellipse cx="142" cy="113" rx="62" ry="12" fill="#FAFBF8" />
            <path d="M97 114C115 105 170 105 187 114" stroke="#B6C8CC" strokeWidth="2" />
            <path d="M68 203C100 215 185 216 217 203" />
            <path d="M116 151H132L117 169H133M145 151H155C167 151 167 160 155 164L145 169H166" strokeWidth="2" />
          </g>
          <g className="coffee-break-sign">
            <path d="M218 120L181 156M218 120L257 151" stroke="#003B5C" strokeWidth="2" />
            <rect x="176" y="148" width="88" height="40" rx="7" fill={opening ? "#003B5C" : "#B9E7F6"} stroke="#003B5C" strokeWidth="2" />
            <text x="220" y="173" textAnchor="middle" fill="#003B5C" className="coffee-break-closed-label">CLOSED</text>
            <text x="220" y="173" textAnchor="middle" fill="#FFFFFF" className="coffee-break-open-label">OPEN</text>
          </g>
        </svg>

        <div className="coffee-break-message" role="status" aria-live="polite" aria-atomic="true">
          <div className="coffee-break-status"><span />{opening ? "เปิดรับออเดอร์แล้ว" : "ปิดรับออเดอร์ชั่วคราว"}</div>
          <h1 id="coffee-break-title">{opening ? <>บาร์พร้อมแล้ว<br />รับกาแฟอะไรดีครับ</> : <>พักบาร์สักครู่<br />แล้วพบกันแก้วหน้าครับ</>}</h1>
          <p>{opening ? <>กำลังพาคุณไปเลือกเมนูโปรด<br />ยินดีต้อนรับกลับมาครับ</> : <>ขณะนี้ร้านปิดรับออเดอร์ออนไลน์<br />ขอบคุณที่แวะมาหาเรานะครับ</>}</p>
        </div>

        {hasOrders && <button type="button" className="coffee-break-button" onClick={onOpenOrders}>ดูออเดอร์ของฉัน <span aria-hidden="true">→</span></button>}
        <p className="coffee-break-live">เมื่อร้านเปิดรับออเดอร์<br />หน้านี้จะอัปเดตอัตโนมัติ</p>
        <footer className="coffee-break-footer">CRAFTED FOR PERFORMANCE</footer>
      </section>
    </main>
  );
}
