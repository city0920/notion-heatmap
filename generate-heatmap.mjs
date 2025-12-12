import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const NOTION_VERSION = '2022-06-28';

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getColorByCount(count) {
  const colors = ['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'];
  if (count === 0) return colors[0];
  if (count === 1) return colors[1];
  if (count <= 3) return colors[2];
  if (count <= 6) return colors[3];
  return colors[4];
}

async function fetchCounts(DB_ID, TOKEN) {
  const body = {
    filter: { property: '新闻日期', date: { is_not_empty: true } },
    sorts: [{ property: '新闻日期', direction: 'ascending' }]
  };

  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  const data = await res.json();

  const counts = {};
  for (const record of data.results) {
    const dateProp = record.properties?.['新闻日期']?.date;
    if (dateProp?.start) {
      const dateStr = dateProp.start.split('T')[0];
      counts[dateStr] = (counts[dateStr] || 0) + 1;
    }
  }
  return counts;
}

function generateHeatmapSVG(counts, year) {
  const cellSize = 16;
  const spacing = 4;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const colWidth = cellSize + spacing;
  const rowHeight = cellSize + spacing;
  const leftMargin = 60;
  const topMargin = 30;
  const totalColumns = 12 * 5;
  const svgWidth = leftMargin + totalColumns * colWidth;
  const svgHeight = topMargin + 7 * rowHeight;

  let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="background:#fff">`;

  const weekdays = ['S','M','T','W','T','F','S'];
  for (let w = 0; w < 7; w++) {
    const y = topMargin + w * rowHeight + cellSize / 2 + 3;
    svg += `<text x="10" y="${y}" font-size="10" fill="#999" text-anchor="start">${weekdays[w]}</text>`;
  }

  let globalColIndex = 0;
  for (let month = 0; month < 12; month++) {
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const totalDays = daysInMonth[month];
    const weeksNeeded = Math.ceil((firstDayOfWeek + totalDays) / 7);
    const actualWeeks = Math.min(weeksNeeded, 5);

    if (actualWeeks > 0) {
      const midCol = globalColIndex + Math.floor(actualWeeks / 2);
      const x = leftMargin + midCol * colWidth + cellSize / 2;
      svg += `<text x="${x}" y="16" font-size="11" fill="#586069" text-anchor="middle">${months[month]}</text>`;
    }

    for (let week = 0; week < actualWeeks; week++) {
      for (let weekday = 0; weekday < 7; weekday++) {
        const dayOfMonth = week * 7 + weekday - firstDayOfWeek + 1;
        const x = leftMargin + globalColIndex * colWidth;
        const y = topMargin + weekday * rowHeight;

        if (dayOfMonth >= 1 && dayOfMonth <= totalDays) {
          const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(dayOfMonth).padStart(2,'0')}`;
          const count = counts[dateStr] || 0;
          const color = getColorByCount(count);
          svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}"/>`;
        }
      }
      globalColIndex++;
    }

    for (let pad = actualWeeks; pad < 5; pad++) {
      globalColIndex++;
    }
  }

  svg += '</svg>';
  return svg;
}

async function main() {
  const DB_ID = process.env.DATABASE_ID;
  const TOKEN = process.env.NOTION_TOKEN;
  if (!DB_ID || !TOKEN) {
    throw new Error('Missing DATABASE_ID or NOTION_TOKEN');
  }

  console.log('Fetching data from Notion...');
  const counts = await fetchCounts(DB_ID, TOKEN);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const year = new Date().getFullYear();

  console.log(`Fetched ${total} records for ${year}`);

  const svg = generateHeatmapSVG(counts, year);
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>body { margin: 0; background: white; }</style>
    </head>
    <body>${svg}</body>
    </html>
  `;

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const screenshotPath = path.join(OUTPUT_DIR, 'heatmap.png');
  await page.screenshot({
    path: screenshotPath,
    clip: {
      x: 0,
      y: 0,
      width: 1200,
      height: 180
    }
  });

  await browser.close();
  console.log(`✅ Heatmap saved to ${screenshotPath}`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
