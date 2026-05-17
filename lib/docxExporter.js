const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');

function parseIntoSections(content, outputStructure) {
  const sections = [];
  // Build a regex that matches any section header from outputStructure (ALL CAPS version)
  const headerPatterns = outputStructure.map(s => s.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const headerRegex = new RegExp(`^(${headerPatterns.join('|')})\\s*$`, 'im');

  const lines = content.split('\n');
  let currentSection = null;
  let currentBody = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip em-dash divider lines
    if (/^[—\-─]{4,}$/.test(trimmed)) continue;

    const isHeader = outputStructure.some(s => trimmed.toUpperCase() === s.toUpperCase());
    if (isHeader) {
      if (currentSection !== null) {
        sections.push({ heading: currentSection, body: currentBody.join('\n').trim() });
      }
      currentSection = trimmed;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentSection !== null) {
    sections.push({ heading: currentSection, body: currentBody.join('\n').trim() });
  }

  // If no sections were parsed (e.g. plain text without known headers), treat whole content as one block
  if (sections.length === 0) {
    sections.push({ heading: null, body: content.trim() });
  }

  return sections;
}

function buildParagraphsFromBody(bodyText) {
  const paragraphs = [];
  const lines = bodyText.split('\n');
  for (const line of lines) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 22 })],
        spacing: { after: line.trim() === '' ? 0 : 100 },
      })
    );
  }
  return paragraphs;
}

async function exportToDocx(doc) {
  const sections = parseIntoSections(doc.content, doc.outputStructure || []);

  const docChildren = [
    // Document title block
    new Paragraph({
      children: [new TextRun({ text: doc.title, bold: true, font: 'Calibri', size: 32 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Prepared: ${new Date(doc.created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · Version v1.0`, font: 'Calibri', size: 18, color: '6B7280' })],
      spacing: { after: 400 },
    }),
  ];

  for (const section of sections) {
    if (section.heading) {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: section.heading.toUpperCase(), bold: true, font: 'Calibri', size: 24 })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 80 },
          border: { bottom: { color: 'D8D3CA', style: BorderStyle.SINGLE, size: 6 } },
        })
      );
    }
    if (section.body) {
      docChildren.push(...buildParagraphsFromBody(section.body));
    }
  }

  const wordDoc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [{ children: docChildren }],
  });

  return Packer.toBuffer(wordDoc);
}

module.exports = { exportToDocx };
