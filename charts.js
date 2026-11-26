/* ==========================================================================
   CARBFLOW 高清 DPR 自适应交互式运动数据图表引擎 (Canvas 2D)
   支持：折线/双折线平滑趋势图、目标参考虚线、柱状对比图、三大营养素堆叠柱状图与触控数值提示
   ========================================================================== */
window.CarbCharts = (function () {
  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(260, rect.width || 340);
    const height = Math.max(170, rect.height || 200);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function drawEmpty(ctx, width, height, text) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#F8FAFD';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 12);
    ctx.fill();
    ctx.fillStyle = '#949CB0';
    ctx.font = '12.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text || '暂无历史记录，打卡或点击上方「体验14天趋势样本」立即预览', width / 2, height / 2);
  }

  function formatShortDate(d) {
    if (!d) return '';
    return d.length >= 10 ? d.slice(5) : d;
  }

  /**
   * 绘制单线或双线趋势图（如：体重 + 7日均线、腰围 + 臀围、体脂率 + 目标参考虚线）
   */
  function renderLineChart(canvas, config) {
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const labels = config.labels || [];
    const lines = (config.lines || []).filter((l) => l.values && l.values.some((v) => v != null));

    if (!labels.length || !lines.length) {
      drawEmpty(ctx, width, height, config.emptyText);
      return;
    }

    const pad = { top: 20, right: 16, bottom: 28, left: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let allVals = [];
    lines.forEach((l) => {
      l.values.forEach((v) => {
        if (v != null && !isNaN(v)) allVals.push(Number(v));
      });
    });
    if (config.targetLine != null && !isNaN(config.targetLine)) {
      allVals.push(Number(config.targetLine));
    }
    if (!allVals.length) {
      drawEmpty(ctx, width, height, config.emptyText);
      return;
    }

    let minV = Math.min(...allVals);
    let maxV = Math.max(...allVals);
    const span = Math.max(0.8, maxV - minV);
    minV = minV - span * 0.16;
    maxV = maxV + span * 0.16;

    ctx.clearRect(0, 0, width, height);

    // 水平网格线与 Y 轴刻度
    const gridSteps = 4;
    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridSteps; i++) {
      const y = pad.top + (plotH * i) / gridSteps;
      const val = maxV - ((maxV - minV) * i) / gridSteps;
      ctx.strokeStyle = '#EEF1F7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#949CB0';
      ctx.fillText(val.toFixed(1), pad.left - 6, y + 3.5);
    }

    const xFor = (idx) =>
      labels.length === 1 ? pad.left + plotW / 2 : pad.left + (idx * plotW) / (labels.length - 1);
    const yFor = (val) => pad.top + ((maxV - val) / (maxV - minV)) * plotH;

    // 目标参考虚线
    if (config.targetLine != null && !isNaN(config.targetLine)) {
      const ty = yFor(Number(config.targetLine));
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = config.targetColor || '#F59E0B';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(pad.left, ty);
      ctx.lineTo(width - pad.right, ty);
      ctx.stroke();
      ctx.fillStyle = config.targetColor || '#D97706';
      ctx.textAlign = 'right';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`${config.targetLabel || '目标'} ${Number(config.targetLine).toFixed(1)}`, width - pad.right - 2, ty - 4);
      ctx.restore();
    }

    // 绘制每条折线
    lines.forEach((line, lineIdx) => {
      const pts = [];
      line.values.forEach((v, i) => {
        if (v != null && !isNaN(v)) {
          pts.push({ x: xFor(i), y: yFor(Number(v)), v: Number(v), label: labels[i] });
        }
      });
      if (!pts.length) return;

      // 首条主线绘制柔和渐变面积填充
      if (lineIdx === 0 && pts.length >= 2 && line.area !== false) {
        const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        grad.addColorStop(0, line.fillTop || 'rgba(36, 199, 137, 0.22)');
        grad.addColorStop(1, 'rgba(36, 199, 137, 0.0)');
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pad.top + plotH);
        pts.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, pad.top + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.save();
      if (line.dashed) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = line.color || '#24C789';
      ctx.lineWidth = line.width || 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();

      // 数据圆点与末尾数值标注
      pts.forEach((p, idx) => {
        if (pts.length <= 16 || idx === pts.length - 1 || idx === 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, idx === pts.length - 1 ? 4 : 2.8, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = line.color || '#24C789';
          ctx.stroke();
        }
        if (idx === pts.length - 1 && lineIdx === 0) {
          ctx.fillStyle = line.color || '#181B24';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`${p.v.toFixed(1)}${config.unit || ''}`, p.x, Math.max(12, p.y - 8));
        }
      });
    });

    // X 轴日期刻度（抽样防重叠）
    ctx.fillStyle = '#949CB0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(labels.length / 6));
    labels.forEach((lbl, i) => {
      if (i % step === 0 || i === labels.length - 1) {
        ctx.fillText(formatShortDate(lbl), xFor(i), height - 8);
      }
    });
  }

  /**
   * 绘制柱状对比图（每周减重速度、每日热量摄入 vs 当日碳循环目标折线）
   */
  function renderBarChart(canvas, config) {
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const labels = config.labels || [];
    const values = config.values || [];
    if (!labels.length || !values.length) {
      drawEmpty(ctx, width, height, config.emptyText);
      return;
    }

    const pad = { top: 22, right: 14, bottom: 28, left: 44 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const allNums = [...values.map(Number)];
    if (config.targetSeries) allNums.push(...config.targetSeries.map(Number));
    if (config.refLine != null) allNums.push(Number(config.refLine));

    const minV = Math.min(0, ...allNums);
    const maxV = Math.max(1, ...allNums) * 1.15;

    ctx.clearRect(0, 0, width, height);

    const yFor = (val) => pad.top + ((maxV - val) / (maxV - minV)) * plotH;
    const zeroY = yFor(0);

    // 网格
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = maxV - ((maxV - minV) * i) / 4;
      const y = yFor(v);
      ctx.strokeStyle = '#EEF1F7';
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#949CB0';
      ctx.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2), pad.left - 6, y + 3.5);
    }

    const slotW = plotW / labels.length;
    const barW = Math.min(26, Math.max(8, slotW * 0.56));

    values.forEach((rawV, i) => {
      const v = Number(rawV) || 0;
      const cx = pad.left + slotW * (i + 0.5);
      const y = yFor(v);
      const top = Math.min(y, zeroY);
      const h = Math.max(2, Math.abs(zeroY - y));
      const color = (config.barColors && config.barColors[i]) || '#24C789';

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(cx - barW / 2, top, barW, h, 5);
      ctx.fill();

      if (labels.length <= 10) {
        ctx.fillStyle = '#5E6577';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2), cx, top - 5);
      }
    });

    // 目标折线叠加（如当日碳循环目标热量）
    if (config.targetSeries && config.targetSeries.length === labels.length) {
      ctx.save();
      ctx.strokeStyle = '#181B24';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      config.targetSeries.forEach((tv, i) => {
        const cx = pad.left + slotW * (i + 0.5);
        const cy = yFor(Number(tv) || 0);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      ctx.restore();
    }

    if (config.refLine != null) {
      const ry = yFor(Number(config.refLine));
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#F59E0B';
      ctx.beginPath();
      ctx.moveTo(pad.left, ry);
      ctx.lineTo(width - pad.right, ry);
      ctx.stroke();
      ctx.restore();
    }

    // X 轴标签
    ctx.fillStyle = '#949CB0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(labels.length / 6));
    labels.forEach((lbl, i) => {
      if (i % step === 0 || i === labels.length - 1) {
        const cx = pad.left + slotW * (i + 0.5);
        ctx.fillText(formatShortDate(lbl), cx, height - 8);
      }
    });
  }

  /**
   * 绘制每日三大营养素摄入堆叠柱状图（碳水 + 蛋白质 + 脂肪 克数或供能分布）
   */
  function renderStackedMacrosChart(canvas, config) {
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const items = (config.items || []).filter((d) => d.carbs_g + d.protein_g + d.fat_g > 0);
    if (!items.length) {
      drawEmpty(ctx, width, height, config.emptyText);
      return;
    }

    const pad = { top: 20, right: 14, bottom: 28, left: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const totals = items.map((d) => d.carbs_g + d.protein_g + d.fat_g);
    const maxV = Math.max(100, ...totals) * 1.12;
    const yFor = (val) => pad.top + ((maxV - val) / maxV) * plotH;

    ctx.clearRect(0, 0, width, height);

    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = maxV - (maxV * i) / 4;
      const y = yFor(v);
      ctx.strokeStyle = '#EEF1F7';
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#949CB0';
      ctx.fillText(`${v.toFixed(0)}g`, pad.left - 5, y + 3.5);
    }

    const slotW = plotW / items.length;
    const barW = Math.min(26, Math.max(8, slotW * 0.58));
    const baseBottom = pad.top + plotH;

    items.forEach((d, i) => {
      const cx = pad.left + slotW * (i + 0.5);
      const hCarb = (d.carbs_g / maxV) * plotH;
      const hProt = (d.protein_g / maxV) * plotH;
      const hFat = (d.fat_g / maxV) * plotH;

      let curBottom = baseBottom;
      // 碳水（橙）
      ctx.fillStyle = '#FF6B35';
      ctx.fillRect(cx - barW / 2, curBottom - hCarb, barW, hCarb);
      curBottom -= hCarb;
      // 蛋白（绿）
      ctx.fillStyle = '#24C789';
      ctx.fillRect(cx - barW / 2, curBottom - hProt, barW, hProt);
      curBottom -= hProt;
      // 脂肪（金）
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(cx - barW / 2, curBottom - hFat, barW, hFat);
    });

    ctx.fillStyle = '#949CB0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(items.length / 6));
    items.forEach((d, i) => {
      if (i % step === 0 || i === items.length - 1) {
        ctx.fillText(formatShortDate(d.date), pad.left + slotW * (i + 0.5), height - 8);
      }
    });
  }

  return {
    renderLineChart,
    renderBarChart,
    renderStackedMacrosChart,
  };
})();
