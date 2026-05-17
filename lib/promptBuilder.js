const BASE_SYSTEM_PROMPT = `You are a business document specialist with deep expertise in B2B contracts, proposals, and operational governance documents. You produce documents that are:

- Professionally formatted and ready for review by business owners or legal counsel
- Specific and concrete — never generic filler or placeholder text like "[insert here]"
- Structured with clear section headers in ALL CAPS followed by em-dash dividers
- Appropriate in tone: formal for contracts and legal documents, executive-ready for proposals
- Complete: every required section must be substantively written, not skipped

Formatting rules:
- Section headers: ALL CAPS (e.g. PARTIES, SCOPE OF WORK)
- Under each header: a line of em-dashes (————————————————)
- For legal/contract documents: number all clauses (1.1, 1.2, 1.2.1, etc.)
- Use consistent date format: Month DD, YYYY
- Signature blocks: formal lines for Party Name, Authorized Signatory, Title, Date
- Document reference block at top: document title, prepared date, parties, version (v1.0)
- No markdown asterisks, hashtags, or formatting symbols — plain text only`;

function buildPrompt(docTypeEntry, fieldValues, voiceProfile) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Build labeled brief from field values
  const allFields = [...(docTypeEntry.requiredFields || []), ...(docTypeEntry.optionalFields || [])];
  const briefLines = allFields
    .map(f => {
      const val = fieldValues[f.key];
      if (!val || (typeof val === 'string' && !val.trim())) return null;
      return `${f.label}: ${val}`;
    })
    .filter(Boolean);

  const sectionList = docTypeEntry.outputStructure
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

  const voiceSection = voiceProfile
    ? `\nWRITING STYLE / VOICE GUIDANCE:\n${voiceProfile}\n`
    : '';

  const system = `${BASE_SYSTEM_PROMPT}\n\n${docTypeEntry.systemPromptAddition || ''}`;

  const userMessage = `Write a ${docTypeEntry.label} using the following details:

DOCUMENT DETAILS
————————————————
${briefLines.join('\n')}
Prepared date: ${today}
${voiceSection}
REQUIRED SECTIONS (produce them in this exact order):
${sectionList}

Write the complete document now. Begin with the document reference block. Use the section order above exactly. Make every section substantive — no placeholders.`;

  return { system, userMessage };
}

module.exports = { buildPrompt };
