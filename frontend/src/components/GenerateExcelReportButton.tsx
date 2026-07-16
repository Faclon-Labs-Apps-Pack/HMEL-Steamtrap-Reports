import { useState } from 'react';
import type { Workbook } from 'exceljs';
import { Button } from '@faclon-labs/design-sdk/Button';
import { downloadWorkbook } from '../reportGeneration/downloadWorkbook';

interface GenerateExcelReportButtonProps {
  idleLabel: string;
  generate: (onProgress: (progress: { label: string }) => void) => Promise<Workbook>;
  filename: () => string;
}

export function GenerateExcelReportButton({ idleLabel, generate, filename }: GenerateExcelReportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState(idleLabel);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsGenerating(true);
    setError(null);
    try {
      const workbook = await generate((progress) => setProgressLabel(progress.label));
      await downloadWorkbook(workbook, filename());
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
