// ════════════════════════════════════════════════════════
// pdf-export.js
// MORNING ROUND DIGITAL — PT. RISKI HARIYANTO
// Format mengikuti standar laporan fisik pabrik
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// EXPORT PDF — Rekapitulasi Semua Laporan
// ════════════════════════════════════════════════════════
function exportPDF() {
  if (!window.jspdf) { window.toast('Library PDF belum siap', 'red'); return; }
  const { jsPDF } = window.jspdf;
  const doc       = new jsPDF({ orientation: 'landscape' });
  const PAGE_W    = doc.internal.pageSize.getWidth();
  const MARGIN    = 10;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const printDate = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });

  _drawKopSurat(doc, PAGE_W, MARGIN, CONTENT_W, 'Rekapitulasi Laporan Morning Round', printDate, null);

  let reps = window.getReports();
  if (window.currentUser?.role === 'petugas') reps = reps.filter(r => r.user?.uid === window.currentUser.uid);
  if (!reps.length) { window.toast('Tidak ada laporan untuk diekspor', 'red'); return; }

  const data = reps.map(r => {
    const totalF = Object.keys(r.findings||{}).length + (r.extraFindings||[]).length;
    const openF  = Object.values(r.findings||{}).filter(f=>f.status!=='Closed').length +
                   (r.extraFindings||[]).filter(ef=>ef.status!=='Closed').length;
    const verifBy = r.verified ? (r.verif_action === 'approve' ? 'Disetujui' : 'Ditolak') : 'Belum';
    return [ r.tanggal, r.area, r.user?.displayName||'—', r.shift,
             (r.skor5r||0)+'%', r.status, verifBy, totalF+'('+openF+' open)' ];
  });

  doc.autoTable({
    startY: 52,
    head: [['Tanggal','Area Inspeksi','Petugas','Shift','Skor 5R','Status','Persetujuan FM','Temuan']],
    body: data,
    styles:     { fontSize: 7.5, cellPadding: 2.5, lineColor:[0,0,0], lineWidth:0.25 },
    headStyles: { fillColor:[255,200,0], textColor:[0,0,0], fontStyle:'bold', lineColor:[0,0,0], lineWidth:0.3 },
    alternateRowStyles: { fillColor:[252,252,248] },
    columnStyles: {
      0:{cellWidth:24}, 1:{cellWidth:50}, 2:{cellWidth:34}, 3:{cellWidth:18},
      4:{cellWidth:18,halign:'center'}, 5:{cellWidth:24,halign:'center'},
      6:{cellWidth:28,halign:'center'}, 7:{cellWidth:28,halign:'center'}
    }
  });

  const finalY = doc.lastAutoTable?.finalY || 200;
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(150,150,150);
  doc.text('PT. RISKI HARIYANTO — FRM/MR-001 — Dicetak: ' + printDate, PAGE_W/2, finalY + 8, { align:'center' });
  doc.save('Rekap_MorningRound_' + window.today() + '.pdf');
  window.toast('PDF rekapitulasi berhasil diunduh 📄', 'lime');
}

// ════════════════════════════════════════════════════════
// EXPORT SINGLE PDF — Format standar laporan fisik pabrik
// ════════════════════════════════════════════════════════
function exportSinglePDF() {
  if (!window.selectedReport) { window.toast('Pilih laporan terlebih dahulu', 'red'); return; }
  if (!window.jspdf)          { window.toast('Library PDF belum siap', 'red'); return; }

  const { jsPDF } = window.jspdf;
  const r         = window.selectedReport;
  const doc       = new jsPDF({ orientation: 'landscape' });
  const PAGE_W    = doc.internal.pageSize.getWidth();
  const PAGE_H    = doc.internal.pageSize.getHeight();
  const MARGIN    = 10;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const printDate = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });

  _drawKopSurat(doc, PAGE_W, MARGIN, CONTENT_W, 'Laporan Pengamatan Morning Round', printDate, r);

  let nextY = 50;

  // ── Kumpulkan semua temuan ────────────────────────────
  const allFindings = [
    ...Object.keys(r.findings || {}).map(k => {
      const f    = r.findings[k];
      const item = window.ITEMS_5R.find(i => i.key === k);
      return {
        fotoBefore:  f.photo         || '',
        temuan:      f.description   || '—',
        rekomendasi: f.capa_immediate  || '—',
        actionPlan:  f.capa_corrective || '—',
        fotoAfter:   f.closingPhoto   || '',
        pic:         f.dept           || '—',
        dueDate:     f.dueDate        || '—',
        actualDate:  f.closedAt       || '—',
        status:      f.status         || 'Open',
        keterangan:  f.capa_corrective_pic || '—',
        dept:        f.dept           || '—',
        kategoriLine1: f.category     || 'Delivery',
        kategoriLine2: item ? 'GMP 5R' : '5R',
        category:    f.category       || 'Delivery'
      };
    }),
    ...(r.extraFindings || []).map(ef => ({
      fotoBefore:  ef.photo          || '',
      temuan:      ef.description    || ef.label || '—',
      rekomendasi: ef.capa_immediate  || '—',
      actionPlan:  ef.capa_corrective || '—',
      fotoAfter:   ef.closingPhoto   || '',
      pic:         ef.dept           || '—',
      dueDate:     ef.dueDate        || '—',
      actualDate:  ef.closedAt       || '—',
      status:      ef.status         || 'Open',
      keterangan:  ef.capa_corrective_pic || '—',
      dept:        ef.dept           || '—',
      kategoriLine1: ef.category     || 'Delivery',
      kategoriLine2: 'GMP 5R',
      category:    ef.category       || 'Delivery'
    }))
  ];

  // ── Tabel Temuan Utama ────────────────────────────────
  const COL_FOTO_BEFORE = 1;
  const COL_FOTO_AFTER  = 5;
  const FOTO_CELL_SIZE  = 19;
  const ROW_MIN_HEIGHT  = 26;
  const HEAD_BG         = [255, 200, 0];
  const HEAD_TEXT       = [0, 0, 0];

  if (!allFindings.length) {
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(180,180,180);
    doc.text('Tidak ada temuan pada laporan ini.', PAGE_W/2, nextY + 15, { align:'center' });
  } else {
    const tableBody = allFindings.map((f, i) => [
      i + 1,
      f.fotoBefore,
      f.temuan,
      f.rekomendasi,
      f.actionPlan,
      f.fotoAfter,
      f.pic,
      _fmtDue(f.dueDate),
      f.actualDate === '—' ? '—' : _fmtDue(f.actualDate),
      f.status,
      f.keterangan,
      f.dept,
      f.kategoriLine1 + '\n' + f.kategoriLine2
    ]);

    doc.autoTable({
      startY: nextY,
      head: [['No','Foto\nTemuan','Temuan','Rekomendasi','Action Plan',
              'Foto\nAfter','PIC','Due\nDate','Actual\nDate',
              'Status','Keterangan','DEPT','Kategori']],
      body: tableBody,
      styles: {
        fontSize: 6.5, cellPadding: 2, valign:'top',
        minCellHeight: ROW_MIN_HEIGHT,
        lineColor:[0,0,0], lineWidth:0.25, overflow:'linebreak'
      },
      headStyles: {
        fillColor: HEAD_BG, textColor: HEAD_TEXT, fontStyle:'bold',
        halign:'center', valign:'middle', fontSize:6.5,
        lineColor:[0,0,0], lineWidth:0.3
      },
      alternateRowStyles: { fillColor:[252,252,248] },
      columnStyles: {
        0:  { cellWidth: 8,  halign:'center'  },
        1:  { cellWidth: 22, halign:'center'  },
        2:  { cellWidth: 38                   },
        3:  { cellWidth: 38                   },
        4:  { cellWidth: 38                   },
        5:  { cellWidth: 22, halign:'center'  },
        6:  { cellWidth: 16, halign:'center'  },
        7:  { cellWidth: 18, halign:'center'  },
        8:  { cellWidth: 18, halign:'center'  },
        9:  { cellWidth: 14, halign:'center'  },
        10: { cellWidth: 22                   },
        11: { cellWidth: 12, halign:'center'  },
        12: { cellWidth: 17, halign:'center'  }
      },
      didParseCell: function(data) {
        if (data.section === 'body') {
          // Kosongkan teks kolom foto
          if (data.column.index === COL_FOTO_BEFORE || data.column.index === COL_FOTO_AFTER) {
            data.cell.text = [];
          }
          // Warna status
          if (data.column.index === 9) {
            const val = data.cell.raw;
            if (val === 'Closed')      { data.cell.styles.textColor = [20,120,20]; data.cell.styles.fontStyle = 'bold'; }
            else if (val === 'Open')   { data.cell.styles.textColor = [200,30,30]; data.cell.styles.fontStyle = 'bold'; }
          }
        }
      },
      didDrawCell: function(data) {
        if (data.section !== 'body') return;
        if (data.column.index !== COL_FOTO_BEFORE && data.column.index !== COL_FOTO_AFTER) return;
        const imgData = data.cell.raw;
        if (!imgData || typeof imgData !== 'string' || imgData.length < 50) {
          doc.setDrawColor(210,210,210); doc.setLineWidth(0.2);
          doc.rect(data.cell.x+2, data.cell.y+2, data.cell.width-4, data.cell.height-4);
          doc.setFontSize(5.5); doc.setTextColor(190,190,190);
          doc.text('—', data.cell.x+data.cell.width/2, data.cell.y+data.cell.height/2+1.5, {align:'center'});
          doc.setTextColor(0,0,0);
          return;
        }
        try {
          const avW  = data.cell.width  - 4;
          const avH  = data.cell.height - 4;
          const size = Math.min(avW, avH, FOTO_CELL_SIZE);
          const imgX = data.cell.x + (data.cell.width  - size) / 2;
          const imgY = data.cell.y + (data.cell.height - size) / 2;
          doc.addImage(imgData, 'JPEG', imgX, imgY, size, size);
        } catch(e) {
          doc.setFontSize(5); doc.setTextColor(150,150,150);
          doc.text('Gagal', data.cell.x+data.cell.width/2, data.cell.y+data.cell.height/2, {align:'center'});
          doc.setTextColor(0,0,0);
        }
      },
      didDrawPage: function(data) {
        if (data.pageNumber > 1) {
          doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0,0,0);
          doc.text('PT. RISKI HARIYANTO — Morning Round — ' + (r.tanggal||'') + ' — ' + (r.area||''),
            PAGE_W/2, 7, { align:'center' });
          doc.setLineWidth(0.4); doc.setDrawColor(255,200,0);
          doc.line(0, 9, PAGE_W, 9);
        }
      }
    });
  }

  // ── Rekap Kategori & Ringkasan ───────────────────────
  const finalY = (doc.lastAutoTable?.finalY || nextY) + 5;
  const HEAD_BG2   = [255, 200, 0];

  // Hitung per kategori
  const catCount = {};
  window.CATEGORIES.forEach(c => { catCount[c] = 0; });
  allFindings.forEach(f => {
    if (catCount[f.category] !== undefined) catCount[f.category]++;
    else catCount[f.category] = 1;
  });
  const catRows = [...window.CATEGORIES.map(c => [c, catCount[c]||0]), ['Total', allFindings.length]];

  doc.autoTable({
    startY: finalY, margin:{left: MARGIN}, tableWidth: 52,
    head: [['Kategori','Jumlah']],
    body: catRows,
    styles:     { fontSize:7, cellPadding:2, lineColor:[0,0,0], lineWidth:0.25 },
    headStyles: { fillColor:HEAD_BG2, textColor:[0,0,0], fontStyle:'bold', halign:'center', lineColor:[0,0,0] },
    columnStyles: { 0:{cellWidth:34}, 1:{cellWidth:18,halign:'center'} },
    didParseCell: function(data) {
      if (data.section==='body' && data.row.index === catRows.length-1) {
        data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255,200,0];
      }
    }
  });

  const summaryRows = [
    ['GMP 5R',  allFindings.filter(f=>f.category!=='Safety').length],
    ['SAFETY',  allFindings.filter(f=>f.category==='Safety').length],
    ['IMPROVE', allFindings.length]
  ];

  doc.autoTable({
    startY: finalY, margin:{left: MARGIN+58}, tableWidth:46,
    head: [['KATEGORI','JUMLAH']],
    body: summaryRows,
    styles:     { fontSize:7, cellPadding:2, lineColor:[0,0,0], lineWidth:0.25 },
    headStyles: { fillColor:HEAD_BG2, textColor:[0,0,0], fontStyle:'bold', halign:'center', lineColor:[0,0,0] },
    columnStyles: { 0:{cellWidth:26}, 1:{cellWidth:20,halign:'center',fontStyle:'bold'} }
  });

  // ── Blok TTD ─────────────────────────────────────────
  const ttdY     = finalY;
  const ttdStart = MARGIN + 120;
  const ttdW     = (CONTENT_W - 120) / 2;
  const ttdH     = 28;
  const ttdLine  = 0.3;

  doc.setDrawColor(0,0,0); doc.setLineWidth(ttdLine);

  // Dept Head
  doc.rect(ttdStart, ttdY, ttdW, ttdH);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
  doc.text('Dept Head', ttdStart + ttdW/2, ttdY + 4.5, { align:'center' });
  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(100,100,100);
  doc.text('Paraf :', ttdStart + 3, ttdY + 8.5);
  if (r.verified && r.verif_action === 'approve') {
    if (r.verif_ttd) {
      try { doc.addImage(r.verif_ttd, 'PNG', ttdStart+4, ttdY+10, ttdW-8, 10); } catch(e) {}
    } else {
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(20,130,20);
      doc.text('✔ DISETUJUI', ttdStart+ttdW/2, ttdY+17, { align:'center' }); doc.setTextColor(0,0,0);
    }
    const vd = r.verif_at ? new Date(r.verif_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '';
    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text(r.verif_by||window.USERS.dept_head.displayName, ttdStart+ttdW/2, ttdY+ttdH-6, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(5.5); doc.setTextColor(100,100,100);
    doc.text(vd, ttdStart+ttdW/2, ttdY+ttdH-2.5, {align:'center'});
  } else {
    doc.setFont('helvetica','italic'); doc.setFontSize(6.5); doc.setTextColor(180,180,180);
    doc.text('(Belum Diverifikasi)', ttdStart+ttdW/2, ttdY+ttdH/2+2, {align:'center'});
  }

  // Factory Manager
  const xFM = ttdStart + ttdW;
  doc.setDrawColor(0,0,0); doc.setTextColor(0,0,0);
  doc.rect(xFM, ttdY, ttdW, ttdH);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
  doc.text('FM', xFM+ttdW/2, ttdY+4.5, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(100,100,100);
  doc.text('Mengetahui :', xFM+3, ttdY+8.5);
  doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
  doc.text(window.USERS.factory_manager.displayName, xFM+ttdW/2, ttdY+ttdH-6, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(5.5); doc.setTextColor(100,100,100);
  doc.text('Factory Manager', xFM+ttdW/2, ttdY+ttdH-2.5, {align:'center'});

  // Footer
  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(150,150,150);
  doc.text('PT. RISKI HARIYANTO — FRM/MR-001 — Dicetak: '+printDate, PAGE_W/2, PAGE_H-4, {align:'center'});

  const safeName = (r.area||'Laporan').replace(/[^a-zA-Z0-9_\-]/g,'_');
  doc.save('MR_'+safeName+'_'+(r.tanggal||window.today())+'.pdf');
  window.toast('PDF berhasil diunduh 📄', 'lime');
}

// ════════════════════════════════════════════════════════
// HELPER: Kop Surat Standar (berkotak seperti format fisik)
// ════════════════════════════════════════════════════════
function _drawKopSurat(doc, PAGE_W, MARGIN, CONTENT_W, judulDok, printDate, r) {
  const KOP_TOP  = MARGIN;
  const KOP_H    = 38;
  const LOGO_W   = 22;
  const NOMOR_W  = 38;
  const NAMA_W   = CONTENT_W - LOGO_W - NOMOR_W;
  const INFO_Y   = KOP_TOP + 20;     // garis pisah baris atas vs baris info

  doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);

  // Border luar
  doc.rect(MARGIN, KOP_TOP, CONTENT_W, KOP_H);
  // Garis vertikal logo
  doc.line(MARGIN+LOGO_W, KOP_TOP, MARGIN+LOGO_W, KOP_TOP+KOP_H);
  // Garis vertikal nomor dokumen
  doc.line(MARGIN+LOGO_W+NAMA_W, KOP_TOP, MARGIN+LOGO_W+NAMA_W, KOP_TOP+KOP_H);
  // Garis horizontal bawah baris nama
  doc.line(MARGIN, INFO_Y, MARGIN+CONTENT_W, INFO_Y);

  // ── Logo (lingkaran merah + inisial) ─────────────────
  const lx = MARGIN + LOGO_W/2;
  const ly = KOP_TOP + 10;
  doc.setFillColor(200,0,0);
  doc.circle(lx, ly, 7.5, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(255,255,255);
  doc.text('PT.RH', lx, ly+2, {align:'center'});

  // ── Nama Perusahaan ───────────────────────────────────
  const mx = MARGIN + LOGO_W + NAMA_W/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(200,0,0);
  doc.text('PT. RISKI HARIYANTO', mx, KOP_TOP+9, {align:'center'});
  doc.setFontSize(7.5); doc.setTextColor(0,0,0);
  doc.text('DIVISI HEALTH FOOD BALARAJA PLANT', mx, KOP_TOP+15, {align:'center'});
  doc.setFont('helvetica','bolditalic'); doc.setFontSize(7);
  doc.text(judulDok, mx, KOP_TOP+19.5, {align:'center'});

  // ── Nomor Dokumen ─────────────────────────────────────
  const nx = MARGIN + LOGO_W + NAMA_W + NOMOR_W/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0,0,0);
  doc.text('FRM/MR-001', nx, KOP_TOP+8, {align:'center'});
  doc.setLineWidth(0.2); doc.setDrawColor(150,150,150);
  doc.line(MARGIN+LOGO_W+NAMA_W+4, KOP_TOP+10, MARGIN+CONTENT_W-4, KOP_TOP+10);
  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(80,80,80);
  doc.text('Rev: 01-2', nx, KOP_TOP+14, {align:'center'});

  // ── Baris info bawah ─────────────────────────────────
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
  const infoY  = INFO_Y;
  const infoH  = KOP_H - 20;  // 18mm

  if (r) {
    // 4 sel: Nama | Dept | Tanggal | Area
    const PARAF_W = 38;
    const DATA_W  = CONTENT_W - LOGO_W - PARAF_W;
    const SEL_W   = DATA_W / 4;
    const cells   = [
      {label:'Nama',    val: r.user?.displayName || '—'},
      {label:'Dept',    val: r.user?.dept || 'IRGA'   },
      {label:'Tanggal', val: r.tanggal || '—'         },
      {label:'Area',    val: r.area    || '—'         }
    ];

    cells.forEach((cell, i) => {
      const cx = MARGIN + LOGO_W + i * SEL_W;
      if (i > 0) {
        doc.setLineWidth(0.3); doc.setDrawColor(0,0,0);
        doc.line(cx, infoY, cx, KOP_TOP+KOP_H);
      }
      doc.setFont('helvetica','bold'); doc.setFontSize(6); doc.setTextColor(80,80,80);
      doc.text(cell.label+' :', cx+2, infoY+5.5);
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0,0,0);
      // Truncate panjang agar muat
      let val = cell.val;
      const maxW = SEL_W - 26;
      if (doc.getTextWidth(val) > maxW) {
        while (val.length > 3 && doc.getTextWidth(val+'…') > maxW) val = val.slice(0,-1);
        val += '…';
      }
      doc.text(val, cx+22, infoY+5.5);
    });

    // Paraf & Mengetahui
    const parafX = MARGIN + LOGO_W + DATA_W;
    doc.setLineWidth(0.3); doc.setDrawColor(0,0,0);
    doc.line(parafX, infoY, parafX, KOP_TOP+KOP_H);
    const halfP = PARAF_W / 2;
    doc.line(parafX+halfP, infoY, parafX+halfP, KOP_TOP+KOP_H);

    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text('Paraf :', parafX+halfP/2, infoY+4.5, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(80,80,80);
    doc.text('Dept Head', parafX+halfP/2, infoY+11, {align:'center'});

    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(0,0,0);
    doc.text('Mengetahui :', parafX+halfP+halfP/2, infoY+4.5, {align:'center'});
    doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(80,80,80);
    doc.text('FM', parafX+halfP+halfP/2, infoY+11, {align:'center'});

  } else {
    // Rekapitulasi — tampilkan tanggal cetak
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(80,80,80);
    doc.text('Dicetak: '+printDate, MARGIN+LOGO_W+4, infoY+7);
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(0,0,0);
    doc.text(window.currentUser?.displayName||'—', MARGIN+LOGO_W+60, infoY+7);
  }
}

// ════════════════════════════════════════════════════════
// HELPER: Format tanggal ringkas untuk tabel
// ════════════════════════════════════════════════════════
function _fmtDue(str) {
  if (!str || str === '—') return '—';
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'2-digit' });
  } catch(e) { return str; }
}

// ── Expose ke window ──────────────────────────────────────────────────
window.exportPDF       = exportPDF;
window.exportSinglePDF = exportSinglePDF;
