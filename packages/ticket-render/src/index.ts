import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import './ticket.css';

export { Ticket } from './Ticket';
export type { TicketData, TicketLayout } from './Ticket';

/**
 * Export helpers deliberately take the rendered DOM node so preview and file
 * are pixel-identical. Nothing is uploaded or stored.
 */
export async function downloadTicketPng(node: HTMLElement, filename: string) {
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' });
  triggerDownload(dataUrl, filename.endsWith('.png') ? filename : `${filename}.png`);
}

export async function downloadTicketPdf(node: HTMLElement, filename: string) {
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' });
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const pdf = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'px', format: [width, height] });
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
