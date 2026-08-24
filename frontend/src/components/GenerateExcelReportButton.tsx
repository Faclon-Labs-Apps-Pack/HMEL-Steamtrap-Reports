import { useState } from 'react';
import type { Workbook } from 'exceljs';
import { Button } from '@faclon-labs/design-sdk/Button';
import { downloadWorkbook } from '../reportGeneration/downloadWorkbook';

export interface GeneratedReportFile {
  workbook: Workbook;
  fileName: string;
}

interface GenerateExcelReportButtonProps {
  idleLabel: string;
  /** Returns every file the click should download — reports that split per unit return several. */
  generate: (onProgress: (progress: { label: string }) => void) => Promise<GeneratedReportFile[]>;
}

export function GenerateExcelReportButton({ idleLabel, generate }: GenerateExcelReportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState(idleLabel);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsGenerating(true);
    setError(null);
    try {
      const files = await generate((progress) => setProgressLabel(progress.label));
      for (const { workbook, fileName } of files) {
        setProgressLabel(`Downloading ${fileName}…`);
        await downloadWorkbook(workbook, fileName);
      }
    } catch (err) {
      console.error(`[GenerateExcelReportButton:${idleLabel}] Report generation failed:`, err);
      setError(err instanceof Error ? err.message : 'Failed to generate report.');
    } finally {
      setIsGenerating(false);
      setProgressLabel(idleLabel);
    }
  }

  return (
    <div>
      <Button
        variant="Primary"
        isLoading={isGenerating}
        onClick={handleClick}
        label={isGenerating ? progressLabel : idleLabel}
      />
      {error && (
        <p className="BodySmallRegular" style={{ color: 'var(--text-error-default)', marginTop: 'var(--spacing-02)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
