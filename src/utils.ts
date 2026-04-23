export const cleanCode = (text: string) => {
    // 1. Aggressively extract the first code block if it exists (standard Markdown)
    const codeBlockMatch = text.match(/```(?:[\w\-]*)\n([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    // 2. Fallback: Check for blocks that might start with triple backticks but no newline immediately
    const strictMatch = text.match(/```([\s\S]*?)```/);
    if (strictMatch) return strictMatch[1].trim();
    
    // 3. Fallback: If no backticks, check if the LLM outputted a raw JSON structure
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            // Test if it's perfectly valid JSON
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0].trim();
        } catch (e) {
            // Not perfect JSON, but maybe close enough if it's the primary structure
        }
    }

    // 4. Fallback: Remove common leading/trailing prose indicators
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^(Here is the code[:\s]*|Below is the (?:executable|complete) code[:\s]*|File Content[:\s]*)/i, '');
    
    return cleaned.trim();
};

export const waitForOnline = () => new Promise<void>((resolve) => {
  if (navigator.onLine) return resolve();
  const handleOnline = () => {
    window.removeEventListener('online', handleOnline);
    resolve();
  };
  window.addEventListener('online', handleOnline);
});

export const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 4): Promise<Response> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (!navigator.onLine) await waitForOnline();
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
      if (res.status === 503 || res.status === 429) throw new Error(`HTTP${res.status}`);
      return res;
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 16000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
};
