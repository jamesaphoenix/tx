'use client';

import { useState } from 'react';

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex w-full max-w-full flex-col gap-3 rounded-lg border border-fd-border bg-fd-muted/50 py-4 pl-4 pr-3 sm:flex-row sm:items-center sm:justify-between sm:pl-6">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <code className="block min-w-0 break-all text-left text-sm sm:w-max sm:min-w-full sm:whitespace-nowrap sm:pr-2">
          {command}
        </code>
      </div>
      <button
        onClick={handleCopy}
        className="flex w-[5.5rem] shrink-0 cursor-pointer items-center justify-center gap-1.5 self-end rounded-md px-2.5 py-1.5 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground sm:self-auto"
        aria-label="Copy to clipboard"
      >
        {copied ? (
          <>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Copied</span>
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}
