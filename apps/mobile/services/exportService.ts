/**
 * exportService.ts
 * Chart share and export utilities — image, PDF, Excel, text.
 */
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';
import * as XLSX from 'xlsx';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import type { WaveCount, OHLCV } from '@elliott-wave-pro/wave-engine';

// ── Type definitions ──────────────────────────────────────────────────────────

export interface ExportContext {
  ticker:       string;
  timeframe:    string;
  currentPrice: number;
  waveCounts:   WaveCount[];
  candles:      readonly OHLCV[];
  aiCommentary?: string;
  chartRef:     RefObject<View>;
}

// ── Image share ───────────────────────────────────────────────────────────────

export async function shareChartImage(ctx: ExportContext): Promise<void> {
  const uri = await captureRef(ctx.chartRef, { format: 'png', quality: 0.95 });
  // Watermark via HTML + expo-print
  const watermarkedHtml = buildWatermarkHtml(uri, ctx);
  const { uri: pdfUri } = await Print.printToFileAsync({ html: watermarkedHtml, width: 390, height: 844 });
  const pngPath = pdfUri.replace('.pdf', '-chart.pdf');
  await FileSystem.moveAsync({ from: pdfUri, to: pngPath });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pngPath, { mimeType: 'application/pdf', dialogTitle: `${ctx.ticker} Chart` });
  }
}

function buildWatermarkHtml(imageUri: string, ctx: ExportContext): string {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000">
<img src="${imageUri}" style="width:100%;display:block"/>
<div style="background:#000;color:#888;font-size:11px;padding:8px 12px;font-family:monospace">
  Elliott Wave Pro · ${ctx.ticker} ${ctx.timeframe} · $${ctx.currentPrice.toFixed(2)} · ${date}
</div></body></html>`;
}

// ── PDF report ────────────────────────────────────────────────────────────────

export async function exportPDF(ctx: ExportContext): Promise<void> {
  const primary = ctx.waveCounts[0];
  const screenshotUri = await captureRef(ctx.chartRef, { format: 'png', quality: 0.92 });
  const html = buildReportHtml(screenshotUri, ctx, primary);
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4
  const dest = `${FileSystem.documentDirectory}${ctx.ticker}_wave_analysis_${Date.now()}.pdf`;
  await FileSystem.moveAsync({ from: uri, to: dest });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${ctx.ticker} Wave Analysis` });
  }
}

function buildReportHtml(screenshotUri: string, ctx: ExportContext, primary?: WaveCount): string {
  const { ticker, timeframe, currentPrice, candles, aiCommentary } = ctx;
  const date = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const confidence = primary ? Math.round((primary.posterior?.posterior ?? 0) * 100) : 0;
  const waveStructure = primary?.currentWave?.structure ?? '—';
  const t1 = primary?.targets?.[0]?.toFixed(2) ?? '—';
  const t2 = primary?.targets?.[1]?.toFixed(2) ?? '—';
  const t3 = primary?.targets?.[2]?.toFixed(2) ?? '—';
  const stop = primary?.stopPrice?.toFixed(2) ?? '—';
  const lastCandles = [...candles].slice(-50).reverse();

  return `<!DOCTYPE html><html><head><style>
    body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#fff;color:#111}
    h1{font-size:20px;border-bottom:2px solid #111;padding-bottom:8px}
    h2{font-size:15px;color:#333;margin-top:20px}
    .meta{color:#666;font-size:12px;margin-bottom:16px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
    .stat{background:#f5f5f5;padding:10px;border-radius:6px}
    .stat-label{font-size:10px;color:#888;text-transform:uppercase}
    .stat-value{font-size:16px;font-weight:700;margin-top:2px}
    img{width:100%;border-radius:6px;margin:12px 0}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
    th{background:#333;color:#fff;padding:6px 8px;text-align:left}
    td{padding:5px 8px;border-bottom:1px solid #eee}
    tr:nth-child(even){background:#f9f9f9}
    .footer{margin-top:30px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:8px}
  </style></head><body>
    <h1>Elliott Wave Pro — ${ticker} ${timeframe} Analysis</h1>
    <div class="meta">${date} ET · Price: $${currentPrice.toFixed(2)}</div>
    <img src="${screenshotUri}" />
    <h2>Wave Analysis</h2>
    <div class="grid">
      <div class="stat"><div class="stat-label">Wave Structure</div><div class="stat-value">${waveStructure}</div></div>
      <div class="stat"><div class="stat-label">Confidence</div><div class="stat-value">${confidence}%</div></div>
      <div class="stat"><div class="stat-label">T1 Target</div><div class="stat-value">$${t1}</div></div>
      <div class="stat"><div class="stat-label">T2 Target</div><div class="stat-value">$${t2}</div></div>
      <div class="stat"><div class="stat-label">T3 Target</div><div class="stat-value">$${t3}</div></div>
      <div class="stat"><div class="stat-label">Stop</div><div class="stat-value">$${stop}</div></div>
    </div>
    ${aiCommentary ? `<h2>AI Commentary</h2><p style="font-size:13px;line-height:1.6">${aiCommentary}</p>` : ''}
    <h2>Last 50 Candles</h2>
    <table>
      <tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr>
      ${lastCandles.map(c => `<tr>
        <td>${new Date(c.timestamp).toLocaleDateString()}</td>
        <td>$${c.open.toFixed(2)}</td><td>$${c.high.toFixed(2)}</td>
        <td>$${c.low.toFixed(2)}</td><td>$${c.close.toFixed(2)}</td>
        <td>${(c.volume / 1000).toFixed(0)}K</td>
      </tr>`).join('')}
    </table>
    <div class="footer">Generated by Elliott Wave Pro · elliott-wave-pro.com</div>
  </body></html>`;
}

// ── Excel export ──────────────────────────────────────────────────────────────

export async function exportExcel(ctx: ExportContext): Promise<void> {
  try {
    const wb = XLSX.utils.book_new();

    // Sheet 1: OHLCV
    const ohlcvRows = [...ctx.candles].slice(-200).map(c => ({
      Date:   new Date(c.timestamp).toLocaleDateString(),
      Open:   c.open,
      High:   c.high,
      Low:    c.low,
      Close:  c.close,
      Volume: c.volume,
    }));
    const ws1 = XLSX.utils.json_to_sheet(ohlcvRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'OHLCV Data');

    // Sheet 2: Wave Analysis
    const waveRows = ctx.waveCounts.slice(0, 4).map((w, i) => ({
      Rank:       i + 1,
      Structure:  w.currentWave?.structure ?? '',
      Degree:     w.degree ?? '',
      Confidence: `${Math.round((w.posterior?.posterior ?? 0) * 100)}%`,
      T1:         w.targets?.[0]?.toFixed(2) ?? '',
      T2:         w.targets?.[1]?.toFixed(2) ?? '',
      T3:         w.targets?.[2]?.toFixed(2) ?? '',
      Stop:       w.stopPrice?.toFixed(2) ?? '',
    }));
    const ws2 = XLSX.utils.json_to_sheet(waveRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Wave Analysis');

    const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const path = `${FileSystem.documentDirectory}${ctx.ticker}_${ctx.timeframe}_data_${Date.now()}.xlsx`;
    await FileSystem.writeAsStringAsync(path, wbOut, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: `${ctx.ticker} Data Export` });
    }
  } catch (e) {
    console.error('[exportExcel]', e);
    throw e;
  }
}

// ── Copy summary text ─────────────────────────────────────────────────────────

export async function copyChartSummary(ctx: ExportContext, aiCommentary?: string): Promise<void> {
  const primary = ctx.waveCounts[0];
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const confidence = primary ? Math.round((primary.posterior?.posterior ?? 0) * 100) : 0;
  const waveStructure = primary?.currentWave?.structure ?? 'Unknown';
  const t1 = primary?.targets?.[0]?.toFixed(0) ?? '—';
  const t2 = primary?.targets?.[1]?.toFixed(0) ?? '—';
  const t3 = primary?.targets?.[2]?.toFixed(0) ?? '—';
  const stop = primary?.stopPrice?.toFixed(0) ?? '—';
  const rr = (primary?.stopPrice && primary?.targets?.[0])
    ? (Math.abs(primary.targets[0] - ctx.currentPrice) / Math.abs(ctx.currentPrice - primary.stopPrice)).toFixed(1)
    : '—';
  const commentarySnippet = aiCommentary ? `\nAI Insight: ${aiCommentary.slice(0, 280)}` : '';

  const text = `Elliott Wave Pro — ${ctx.ticker} ${ctx.timeframe} Analysis
Date: ${date} · Price: $${ctx.currentPrice.toFixed(2)}
Wave Structure: ${waveStructure}
Confidence: ${confidence}% · Degree: ${primary?.degree ?? '—'}
T1: $${t1} | T2: $${t2} | T3: $${t3}
Stop: $${stop} | R/R: ${rr}x${commentarySnippet}
Generated by Elliott Wave Pro`;

  await Clipboard.setStringAsync(text);
}
