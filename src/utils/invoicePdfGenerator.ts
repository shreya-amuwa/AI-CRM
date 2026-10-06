/**
 * ==============================================================================
 * WABASTORE SUPPORT - INVOICE PDF GENERATOR & HANDLER
 * ==============================================================================
 * Client-side genuine PDF generator and file helper for Technical Support.
 */

export interface InvoiceMetadata {
  invoiceNumber: string;
  customerName: string;
  businessName: string;
  services: string[];
  amount: number;
  paymentMode: string;
  dateStr?: string;
}

export interface GeneratedInvoiceResult {
  dataUrl: string;
  fileName: string;
  fileSize: string;
}

/**
 * Generates an official, standard-compliant PDF-1.4 tax invoice binary blob
 */
export const generateOfficialInvoicePdf = (data: InvoiceMetadata): GeneratedInvoiceResult => {
  const sanitize = (str: string) => (str || '').replace(/[\\()]/g, ' ');
  const dateStr = data.dateStr || new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const contentLines: string[] = [
    // Header Branding
    'BT',
    '/F1 18 Tf',
    '50 780 Td',
    `(${sanitize('WABASTORE SUPPORT')}) Tj`,
    '/F2 9 Tf',
    '0 -16 Td',
    `(${sanitize('Official Technical Integration & Omnichannel Operations')}) Tj`,
    '0 -13 Td',
    `(${sanitize('Email: techsupport@wabastore.com  |  Support Sub-Department')}) Tj`,
    'ET',

    // Line rule
    '0.8 0.8 0.8 RG',
    '1 w',
    '50 735 m 545 735 l S',

    // Invoice Title & Meta
    'BT',
    '/F1 15 Tf',
    '50 705 Td',
    `(${sanitize('TAX INVOICE / PAYMENT RECEIPT')}) Tj`,
    '/F1 9 Tf',
    '0 -18 Td',
    `(${sanitize('Invoice Number: ' + data.invoiceNumber)}) Tj`,
    '0 -14 Td',
    `(${sanitize('Invoice Date:   ' + dateStr)}) Tj`,
    '0 -14 Td',
    `(${sanitize('Payment Status: PAYMENT DONE (SETTLED)')}) Tj`,
    'ET',

    // Box for Billed To Client
    '0.96 0.97 0.99 rg',
    '0.85 0.88 0.93 RG',
    '50 565 495 75 re B',

    'BT',
    '/F1 10 Tf',
    '0 0 0 rg',
    '65 622 Td',
    `(${sanitize('BILLED TO CLIENT:')}) Tj`,
    '/F2 10 Tf',
    '0 -16 Td',
    `(${sanitize('Client Name:   ' + data.customerName)}) Tj`,
    '0 -14 Td',
    `(${sanitize('Business Name: ' + data.businessName)}) Tj`,
    'ET',

    // Services Header Box (Wabastore Emerald)
    '0.06 0.58 0.44 rg',
    '50 525 495 24 re f',

    'BT',
    '/F1 10 Tf',
    '1 1 1 rg',
    '65 533 Td',
    `(${sanitize('DELIVERED SERVICES & TECHNICAL SPECIFICATIONS')}) Tj`,
    '440 533 Td',
    `(${sanitize('STATUS')}) Tj`,
    'ET',

    // Services Rows
    'BT',
    '0 0 0 rg',
    '/F2 9 Tf',
    '65 500 Td'
  ];

  data.services.forEach((svc, i) => {
    if (i > 0) contentLines.push('0 -18 Td');
    contentLines.push(`(${sanitize(`${i + 1}. ${svc}`)}) Tj`);
    contentLines.push(`375 0 Td (${sanitize('Active / Live')}) Tj -375 0 Td`);
  });

  const summaryTop = Math.max(480 - data.services.length * 18 - 30, 220);

  contentLines.push(
    'ET',
    // Summary Box
    '0.96 0.99 0.97 rg',
    '0.7 0.85 0.75 RG',
    `50 ${summaryTop - 40} 495 65 re B`,

    'BT',
    '0 0 0 rg',
    '/F1 11 Tf',
    `65 ${summaryTop + 5} Td`,
    `(${sanitize('PAYMENT SUMMARY & CONFIRMATION:')}) Tj`,
    '/F2 10 Tf',
    '0 -18 Td',
    `(${sanitize('Amount Paid:  INR ' + (data.amount || 0).toLocaleString('en-IN'))}) Tj`,
    '0 -15 Td',
    `(${sanitize('Payment Mode: ' + (data.paymentMode || 'UPI / Instant Transfer'))}) Tj`,
    'ET',

    // Footer
    'BT',
    '0.5 0.5 0.5 rg',
    '/F2 8 Tf',
    '50 70 Td',
    `(${sanitize('This is an authentic computer-generated invoice from Wabastore Technical Support.')}) Tj`,
    '0 -12 Td',
    `(${sanitize('For onboarding or billing assistance, email: techsupport@wabastore.com')}) Tj`,
    'ET'
  );

  const streamContent = contentLines.join('\n');
  const streamLength = new Blob([streamContent]).size;

  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `6 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`
  ];

  let header = '%PDF-1.4\n';
  let offset = header.length;
  const offsets = [0];

  let body = '';
  for (const obj of objects) {
    offsets.push(offset);
    body += obj;
    offset += obj.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const fullPdf = header + body + xref + trailer;

  const blob = new Blob([fullPdf], { type: 'application/pdf' });
  const dataUrl = `data:application/pdf;base64,${btoa(fullPdf)}`;
  const fileName = `Invoice_${data.invoiceNumber}.pdf`;
  const fileSize = `${(blob.size / 1024).toFixed(1)} KB`;

  return { dataUrl, fileName, fileSize };
};

/**
 * Reads any user-provided PDF File as base64 Data URL
 */
export const readUploadedPdfFile = (
  file: File,
  customInvoiceNumber?: string
): Promise<{ invoiceNumber: string; fileName: string; fileSize: string; dataUrl: string }> => {
  return new Promise((resolve, reject) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return reject(new Error('Selected file is not a valid PDF document.'));
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const invoiceNumber = customInvoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
      const fileSize = `${(file.size / 1024).toFixed(1)} KB`;
      resolve({
        invoiceNumber,
        fileName: file.name,
        fileSize,
        dataUrl
      });
    };
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
};

/**
 * Opens PDF in browser tab safely
 */
export const openPdfInNewTab = (dataUrl: string): void => {
  try {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  } catch (e) {
    const win = window.open();
    if (win) {
      win.document.write(`<iframe src="${dataUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
    } else {
      window.open(dataUrl, '_blank');
    }
  }
};

/**
 * Downloads PDF file directly
 */
export const downloadPdfFile = (dataUrl: string, fileName: string): void => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
