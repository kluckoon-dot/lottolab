/* ── 브라우저에서 엑셀을 직접 읽는다 ──
 *
 * 공급사 API 는 정책이 자주 바뀌어 쫓아다니기 어렵다. 보갬이 직접 만든
 * 계산기와 공급가 비교표를 그냥 끌어다 놓으면 되게 한다.
 *
 * xlsx 는 zip 이고, zip 안의 deflate 는 브라우저의 DecompressionStream 으로 푼다.
 * 외부 라이브러리를 하나도 안 쓴다. CDN 이 막혀도 돌아간다.
 */
(function () {
  "use strict";

  /* ── zip 풀기 ── */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--)
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("엑셀 파일이 아니다 (zip 구조 없음)");
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    const dec = new TextDecoder("utf-8");
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        if (method === 0) out[name] = dec.decode(raw);
        else {
          const ds = new DecompressionStream("deflate-raw");
          const stream = new Blob([raw]).stream().pipeThrough(ds);
          out[name] = dec.decode(await new Response(stream).arrayBuffer());
        }
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  const unesc = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&");
  const colNum = ref => { let c = 0; for (const ch of (ref.match(/^[A-Z]+/) || [""])[0]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

  /* ── 통합문서 읽기 ── */
  async function readWorkbook(buf) {
    const f = await unzip(buf);
    /* 실제 파일을 열어보고 알았다. 엑셀이 직접 쓴 것과 라이브러리가 쓴 것이 다르다.
         <si>  vs  <x:si>        네임스페이스 접두사가 붙기도 한다
         Id 먼저 vs Target 먼저   속성 순서가 바뀌기도 한다
       둘 다 견디게 한다. 접두사는 (?:\w+:)? 로 흘리고 속성은 따로 뽑는다. */
    const TAG = (n, body) => new RegExp("<(?:\\w+:)?" + n + (body ? "[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?" + n + ">" : "[^>]*\\/?>"), "g");
    const attr = (s2, a) => { const m = s2.match(new RegExp("(?:\\w+:)?" + a + '="([^"]*)"')); return m ? m[1] : null; };

    const sst = [];
    if (f["xl/sharedStrings.xml"])
      for (const m of f["xl/sharedStrings.xml"].matchAll(TAG("si", 1)))
        sst.push([...m[1].matchAll(TAG("t", 1))].map(t => unesc(t[1])).join(""));

    /* 시트 이름과 파일을 이어붙인다 */
    const rels = {};
    if (f["xl/_rels/workbook.xml.rels"])
      for (const m of f["xl/_rels/workbook.xml.rels"].matchAll(/<Relationship\b[^>]*>/g)) {
        const id = attr(m[0], "Id"), tgt = attr(m[0], "Target");
        if (id && tgt) rels[id] = tgt.replace(/^\//, "");
      }
    const sheets = [];
    if (f["xl/workbook.xml"])
      for (const m of f["xl/workbook.xml"].matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
        const nm = attr(m[0], "name"), rid = attr(m[0], "id");
        if (!nm) continue;
        const tgt = rels[rid] || "";
        sheets.push({ name: unesc(nm), path: tgt.startsWith("xl/") ? tgt : "xl/" + tgt });
      }
    /* 관계가 깨졌으면 파일 이름으로라도 짝짓는다 */
    if (sheets.length && !sheets.some(s2 => f[s2.path])) {
      const files = Object.keys(f).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
        .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
      sheets.forEach((s2, i) => { if (files[i]) s2.path = files[i]; });
    }

    const out = [];
    for (const sh of sheets) {
      const xml = f[sh.path];
      if (!xml) { out.push({ name: sh.name, rows: [] }); continue; }
      const rows = [];
      for (const rm of xml.matchAll(TAG("row", 1))) {
        const cells = [];
        /* 속성 묶음을 게으르게 잡아야 한다.
           욕심내면 <x:c r="E2" />  의 슬래시까지 삼키고 다음 셀의 </x:c> 를 자기 것으로 쓴다.
           그러면 그 줄 전체가 한 칸씩 밀린다. 실제로 밀렸다. */
        for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
          const attrs = cm[1], body = cm[2] || "";
          const ref = attr(attrs, "r");
          const t = attr(attrs, "t");
          let val = "";
          if (t === "inlineStr") val = [...body.matchAll(TAG("t", 1))].map(x => unesc(x[1])).join("");
          else {
            const v = (body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
            if (v != null) val = t === "s" ? (sst[+v] ?? "") : unesc(v);
          }
          const idx = (ref && /^[A-Z]+\d+$/.test(ref)) ? colNum(ref) : cells.length;
          while (cells.length < idx) cells.push("");
          cells.push(val);
        }
        rows.push(cells);
      }
      out.push({ name: sh.name, rows: rows.filter(r => r.some(x => String(x).trim())) });
    }
    return out;
  }

  /* ── 표 찾기 ──
     머리글이 첫 줄이 아닐 수 있다. 주어진 열 이름이 가장 많이 보이는 줄을 머리글로 본다. */
  function findTable(rows, need) {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(x => String(x).replace(/\s/g, ""));
      const hit = need.filter(n => h.some(c => c.includes(n))).length;
      if (hit >= 2 && (!best || hit > best.hit)) best = { i, hit, head: rows[i] };
    }
    if (!best) return null;
    const idx = {};
    best.head.forEach((c, j) => { idx[String(c).replace(/\s/g, "")] = j; });
    const col = name => {
      const keys = Object.keys(idx);
      const exact = keys.find(k => k === name);
      if (exact != null) return idx[exact];
      const part = keys.find(k => k.includes(name));
      return part != null ? idx[part] : -1;
    };
    return { headRow: best.i, head: best.head, body: rows.slice(best.i + 1), col };
  }

  const num = v => {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
    return isFinite(n) ? n : null;
  };

  /* ── 어떤 장부인지 가려낸다 ── */
  /* 아이템스카우트 연관키워드 내보내기.
     상품수·경쟁강도는 쇼핑검색 API 가 끝난 지금 여기서만 얻는다. 저쪽 화면과 같은 숫자다. */
  function findItemScout(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const h = rows[i].map(x => String(x).replace(/\s/g, ""));
      const at = n => h.indexOf(n);
      if (at("키워드") < 0 || at("상품수") < 0 || at("경쟁강도") < 0) continue;
      return { start: i + 1, col: {
        kw: at("키워드"), dup: at("중복횟수"), cat: at("대표카테고리"), cls: at("키워드분류"),
        shopIdx: at("쇼핑성지수"), pc: at("PC검색"), mo: at("모바일검색"), tot: at("총검색수"),
        prod: at("상품수"), comp: at("경쟁강도"), clk: at("평균클릭수"),
        tpc: at("PC클릭률"), tmo: at("모바일클릭률") } };
    }
    return null;
  }
  function readItemScout(found, rows) {
    const out = [], c = found.col;
    const n = v => { const t = String(v ?? "").replace(/[,%\s]/g, ""); if (!t || t === "-") return null;
      const x = parseFloat(t); return isFinite(x) ? x : null; };
    const g = (r, i) => i >= 0 ? r[i] : "";
    for (const r of rows.slice(found.start)) {
      /* 공백 하나도 다른 키워드다. "홍로사과" 와 "홍로 사과" 는 둘 다 남긴다. */
      const kw = String(g(r, c.kw) ?? "").trim(); if (!kw) continue;
      out.push({ kw, dup: n(g(r, c.dup)), cat: String(g(r, c.cat) ?? "").trim(), cls: String(g(r, c.cls) ?? "").trim(),
        shopIdx: n(g(r, c.shopIdx)), pc: n(g(r, c.pc)) || 0, mo: n(g(r, c.mo)) || 0, tot: n(g(r, c.tot)),
        prod: n(g(r, c.prod)), comp: n(g(r, c.comp)), clk: n(g(r, c.clk)),
        ctrPc: n(g(r, c.tpc)) || 0, ctrMo: n(g(r, c.tmo)) || 0 });
    }
    return out;
  }
  /* 네이버 검색광고 키워드도구에서 내려받은 엑셀.
     머리글이 두 줄이다 (월간검색수 / 월간검색수(PC)·(모바일)). 네이버 공식 원본이라
     이걸 떨구면 그 시점의 숫자로 화면이 갱신된다. 실시간 서버가 없어도 되는 길이다. */
  function findNaverKw(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const h = rows[i].map(x => String(x).replace(/\s/g, ""));
      if (!h.some(c => c === "연관키워드" || c === "키워드")) continue;
      const two = rows[i + 1] ? rows[i + 1].map(x => String(x).replace(/\s/g, "")) : [];
      const at = n => { let j = two.indexOf(n); if (j < 0) j = h.indexOf(n); return j; };
      const col = {
        kw: h.findIndex(c => c === "연관키워드" || c === "키워드"),
        pc: at("월간검색수(PC)"), mo: at("월간검색수(모바일)"),
        cpc: at("월평균클릭수(PC)"), cmo: at("월평균클릭수(모바일)"),
        tpc: at("월평균클릭률(PC)"), tmo: at("월평균클릭률(모바일)"),
        comp: h.findIndex(c => c.includes("경쟁정도")),
        depth: h.findIndex(c => c.includes("노출광고수"))
      };
      if (col.pc >= 0 && col.mo >= 0) return { start: two.some(c => c.includes("(PC)")) ? i + 2 : i + 1, col };
    }
    return null;
  }
  function readNaverKw(found, rows) {
    const out = [], c = found.col;
    const n = v => { const t = String(v ?? "").replace(/[,%\s]/g, ""); if (!t || t === "-") return 0;
      if (t.startsWith("<")) return 0; const x = parseFloat(t); return isFinite(x) ? x : 0; };
    const masked = v => /</.test(String(v ?? ""));
    for (const r of rows.slice(found.start)) {
      const kw = String(r[c.kw] ?? "").trim(); if (!kw) continue;
      out.push({ kw, pc: n(r[c.pc]), mo: n(r[c.mo]), masked: masked(r[c.pc]) || masked(r[c.mo]),
        clickPc: c.cpc >= 0 ? n(r[c.cpc]) : 0, clickMo: c.cmo >= 0 ? n(r[c.cmo]) : 0,
        ctrPc: c.tpc >= 0 ? n(r[c.tpc]) : 0, ctrMo: c.tmo >= 0 ? n(r[c.tmo]) : 0,
        comp: c.comp >= 0 ? String(r[c.comp] ?? "").trim() : "", depth: c.depth >= 0 ? n(r[c.depth]) : 0 });
    }
    return out;
  }

  function detect(book) {
    const names = book.map(s => s.name);
    const sheet = n => book.find(s => s.name === n);

    for (const sh of book) {
      const f = findNaverKw(sh.rows);
      if (f) return { kind: "naverkw", sheet: sh, found: f, book };
    }
    for (const sh of book) {
      const f = findItemScout(sh.rows);
      if (f) return { kind: "itemscout", sheet: sh, found: f, book };
    }

    /* 계산기를 먼저 본다.
       계산기의 설정_원가 탭에도 거래처와 "원 공급가" 가 있어서 공급가표로 오인됐다.
       공헌이익은 계산기에만 있는 열이라 이것을 먼저 묻는 게 맞다. */
    const sum = sheet("요약") || book.find(s => findTable(s.rows, ["공헌이익", "이익률"]));
    if (sum) {
      const t = findTable(sum.rows, ["옵션명", "총원가", "공헌이익"]);
      if (t && t.col("총원가") >= 0 && t.col("공헌이익") >= 0) return { kind: "calc", sheet: sum, t, book };
    }
    /* 공급가 비교표 — 전체상세에 거래처·공급가·중량이 있다 */
    const detail = sheet("전체상세")
      || book.find(s => { const t = findTable(s.rows, ["거래처", "공급가", "중량kg"]); return t && t.col("중량kg") >= 0; });
    if (detail) {
      const t = findTable(detail.rows, ["거래처", "공급가", "중량kg"]);
      if (t && t.col("거래처") >= 0 && t.col("공급가") >= 0) return { kind: "supply", sheet: detail, t, book };
    }
    return { kind: null, names };
  }

  /* ── 공급가 비교표를 표준형으로 ── */
  function readSupply(t) {
    const rows = [];
    for (const r of t.body) {
      const g = n => { const i = t.col(n); return i >= 0 ? r[i] : ""; };
      const sup = String(g("거래처")).trim();
      const price = num(g("공급가"));
      if (!sup || !price) continue;
      const kg = num(g("중량kg"));
      const cMin = num(g("과수최소")), cMax = num(g("과수최대"));
      const cnt = (cMin && cMax) ? (cMin + cMax) / 2 : (cMin || cMax);
      rows.push({
        supplier: sup,
        product: String(g("상품명")).trim(),
        option: String(g("옵션명")).trim(),
        variety: String(g("품종구분")).trim() || String(g("품종")).trim(),
        grade: String(g("크기등급")).trim() || String(g("품위")).trim(),
        kg, count: cnt,
        price, ship: num(g("기본배송비")) || 0,
        total: num(g("배송비포함원가")) || price,
        state: String(g("판매상태")).trim(),
        need: String(g("확인필요사항")).trim(),
        wonKg: kg ? Math.round((num(g("배송비포함원가")) || price) / kg) : null,
        gPer: (kg && cnt) ? Math.round(kg * 1000 / cnt) : null
      });
    }
    return rows;
  }

  /* ── 계산기를 표준형으로 ── */
  function readCalc(t) {
    const rows = [];
    for (const r of t.body) {
      const g = n => { const i = t.col(n); return i >= 0 ? r[i] : ""; };
      const name = String(g("옵션명")).trim();
      const cost = num(g("총원가"));
      if (!name || !cost) continue;
      rows.push({
        name, cost,
        nPrice: num(g("네이버판매가")), nProfit: num(g("네이버공헌이익")),
        nRate: num(g("네이버이익률")), nRoas: num(g("네이버최소ROAS")),
        verdict: String(g("네이버판정")).trim(),
        cPrice: num(g("쿠팡등록가")), cProfit: num(g("쿠팡공헌이익")),
        cRate: num(g("쿠팡이익률")), cRoas: num(g("쿠팡최소ROAS")),
        role: String(g("가격역할")).trim(),
        supplier: String(g("공급처")).trim()
      });
    }
    return rows;
  }

  window.XlsxLab = { readWorkbook, detect, readSupply, readCalc, readNaverKw, readItemScout, findTable, num };
})();
