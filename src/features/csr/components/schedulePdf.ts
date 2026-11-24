import { dayCounts, isShift, workloads } from '../model/check.ts';
import { DAY_NAMES, kindName, templateById } from '../model/defaults.ts';
import { deflate, imagePdf, rgbFromRgba } from '../model/pdf.ts';
import { instantOf, localShift, offsetLabel, shortDate, weekDates, weekRange } from '../model/time.ts';
import type { Plan, WeekInput } from '../model/types.ts';

const TEXT = "'VT323', 'Courier New', monospace", DATA = "'Space Mono', 'Courier New', monospace", DISPLAY = "'DotGothic16', 'VT323', monospace";
const GREEN = '#00ff41', AMBER = '#ffd23f', ORANGE = '#ff8c00', WHITE = '#ffffff', LIGHT = '#e8e8e8', MUTED = '#999999', LINE = '#242424';
const PAD = 56, OPERATOR = 200, DAY = 150, WEEK = 150, HEAD = 156, COLUMNS = 62, ROW = 72, FOOT = 46, LEGEND = 64;

/** Draws the week as one picture: the schedule only, with no site name, logo or address on it. */
export function drawSchedule(input: WeekInput, plan: Plan, clockMode: 'department' | 'local', scale = 2): HTMLCanvasElement {
  const { operators, weekStart } = input;
  const dates = weekDates(weekStart), loads = workloads(input, plan), counts = dayCounts(plan, operators);
  const width = PAD * 2 + OPERATOR + DAY * 7 + WEEK;
  const height = PAD + HEAD + COLUMNS + ROW * operators.length + FOOT * 2 + LEGEND + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, height);
  const text = (value: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 1) => { ctx.fillStyle = color; ctx.fillRect(x1, y1, Math.max(thickness, x2 - x1), Math.max(thickness, y2 - y1)); };
  const right = width - PAD, dayX = (day: number) => PAD + OPERATOR + DAY * day, weekX = PAD + OPERATOR + DAY * 7;

  text('OPERATORS DIVISION', PAD, PAD + 16, `15px ${DATA}`, MUTED);
  const title = text('SCHEDULE', PAD, PAD + 74, `48px ${DISPLAY}`, WHITE);
  text('_', PAD + title + 2, PAD + 74, `48px ${DISPLAY}`, ORANGE);
  text(weekRange(weekStart), right, PAD + 74, `48px ${TEXT}`, GREEN, 'right');
  text(clockMode === 'local' ? 'Hours are shown on each operator’s own clock. “+1” means the shift starts on the next calendar day there.'
    : 'Hours are Pacific time. The department works every day, 6 AM – 8 PM.', PAD, PAD + 116, `24px ${TEXT}`, MUTED);

  let y = PAD + HEAD;
  line(PAD, y - 2, right, y, GREEN, 2);
  ctx.fillStyle = '#060606'; ctx.fillRect(PAD, y, right - PAD, COLUMNS);
  text('Operator', PAD + 16, y + 38, `24px ${TEXT}`, MUTED);
  DAY_NAMES.forEach((name, day) => {
    text(name, dayX(day) + DAY / 2, y + 30, `30px ${TEXT}`, day >= 5 ? ORANGE : WHITE, 'center');
    text(shortDate(dates[day]), dayX(day) + DAY / 2, y + 51, `13px ${DATA}`, MUTED, 'center');
  });
  text('Week', weekX + WEEK / 2, y + 38, `24px ${TEXT}`, MUTED, 'center');
  y += COLUMNS;

  for (const operator of operators) {
    line(PAD, y, right, y);
    text(operator.nick, PAD + 16, y + 33, `32px ${TEXT}`, WHITE);
    text(operator.timeZone ? offsetLabel(operator.timeZone, instantOf(weekStart, 12 * 60)) : 'time zone not set', PAD + 16, y + 57, `19px ${TEXT}`, MUTED);
    dates.forEach((date, day) => {
      const cell = plan[operator.id]?.[day] ?? 'off', x = dayX(day), middle = x + DAY / 2;
      const template = isShift(cell) ? templateById(cell.templateId) : undefined;
      if (!isShift(cell) || !template) {
        if (cell === 'vacation') { ctx.fillStyle = 'rgba(255,51,51,.08)'; ctx.fillRect(x + 3, y + 3, DAY - 6, ROW - 6); }
        text(cell === 'vacation' ? 'vacation' : 'off', middle, y + 44, `26px ${TEXT}`, cell === 'vacation' ? '#d97a7a' : '#6b6b6b', 'center');
        return;
      }
      ctx.fillStyle = cell.kind === 'nv' ? 'rgba(0,255,65,.11)' : 'rgba(255,210,63,.11)'; ctx.fillRect(x + 3, y + 3, DAY - 6, ROW - 6);
      const local = clockMode === 'local' && operator.timeZone ? localShift(date, template, operator.timeZone) : null;
      if (local?.dayShift) {
        ctx.font = `28px ${TEXT}`;
        const hours = ctx.measureText(local.range).width, mark = `${local.dayShift > 0 ? '+' : '−'}${Math.abs(local.dayShift)}`;
        text(local.range, middle - 9, y + 33, `28px ${TEXT}`, LIGHT, 'center');
        text(mark, middle - 9 + hours / 2 + 3, y + 26, `17px ${TEXT}`, ORANGE);
      } else if (clockMode === 'local' && !local) {
        // No time zone on file: the hours stay Pacific, and the cell says so.
        ctx.font = `30px ${TEXT}`;
        const hours = ctx.measureText(template.label).width;
        text(template.label, middle - 26, y + 33, `30px ${TEXT}`, LIGHT, 'center');
        text('Pacific', middle - 26 + hours / 2 + 6, y + 33, `17px ${TEXT}`, MUTED);
      } else text(local ? local.range : template.label, middle, y + 33, `${local ? 28 : 30}px ${TEXT}`, LIGHT, 'center');
      text(kindName(cell.kind), middle, y + 57, `22px ${TEXT}`, cell.kind === 'nv' ? GREEN : AMBER, 'center');
    });
    const load = loads[operator.id];
    text(`${load.shifts} of ${load.required} shifts`, weekX + WEEK / 2, y + 33, `23px ${TEXT}`, load.shifts === load.required ? LIGHT : ORANGE, 'center');
    text(`${Math.round(load.paidMinutes / 6) / 10} paid hours`, weekX + WEEK / 2, y + 57, `20px ${TEXT}`, MUTED, 'center');
    y += ROW;
  }

  for (const [label, key] of [['People on shift', 'headcount'], ['of them non-voice', 'nonvoice']] as const) {
    line(PAD, y, right, y);
    text(label, PAD + 16, y + 30, `22px ${TEXT}`, MUTED);
    counts.forEach((count, day) => text(String(count[key]), dayX(day) + DAY / 2, y + 31, `28px ${TEXT}`, LIGHT, 'center'));
    y += FOOT;
  }
  line(PAD, y, right, y);
  for (let day = 0; day <= 7; day += 1) line(dayX(day), PAD + HEAD, dayX(day) + 1, y);

  y += 40;
  ctx.fillStyle = 'rgba(0,255,65,.5)'; ctx.fillRect(PAD, y - 14, 14, 14);
  const first = text('Non-voice: the non-voice channels and calls, covers both lines', PAD + 24, y, `22px ${TEXT}`, MUTED);
  ctx.fillStyle = 'rgba(255,210,63,.55)'; ctx.fillRect(PAD + 24 + first + 36, y - 14, 14, 14);
  text('Voice: calls only', PAD + 24 + first + 60, y, `22px ${TEXT}`, MUTED);
  return canvas;
}

/** The week as a one-page PDF. The file carries only the picture and a neutral title. */
export async function schedulePdf(input: WeekInput, plan: Plan, clockMode: 'department' | 'local'): Promise<Blob> {
  await Promise.all([`32px ${TEXT}`, `15px ${DATA}`, `48px ${DISPLAY}`].map(font => document.fonts.load(font)));
  const canvas = drawSchedule(input, plan, clockMode);
  const { width, height } = canvas;
  const title = `Operators Division schedule, ${weekRange(input.weekStart)}`;
  const page = { width, height, pageWidth: width * 0.375, pageHeight: height * 0.375, title };
  if (typeof CompressionStream !== 'undefined') {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    return new Blob([imagePdf({ ...page, data: await deflate(rgbFromRgba(pixels)), filter: 'FlateDecode' }) as BlobPart], { type: 'application/pdf' });
  }
  // Older browsers: a JPEG goes into the same one-page file.
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!jpeg) throw new Error('The browser could not render the schedule.');
  return new Blob([imagePdf({ ...page, data: new Uint8Array(await jpeg.arrayBuffer()), filter: 'DCTDecode' }) as BlobPart], { type: 'application/pdf' });
}
