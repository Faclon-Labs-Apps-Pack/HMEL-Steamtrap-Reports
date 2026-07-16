export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  formatFile: string;
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'management-report',
    name: 'Steam Trap Management Report',
    description:
      'Plant/unit-level rollup of steam trap health, cost of steam, losses/savings, and a corrective action log. Generated per refinery/petchem category.',
    formatFile: './files/management-report-format.xlsx',
  },
  {
    id: 'daily-report',
    name: 'Steam Trap Daily Report',
    description:
      'Per-device daily status summary and live sensor readings (pressure/temperature) for a single reporting window.',
    formatFile: './files/daily-report-format.xlsx',
  },
];
