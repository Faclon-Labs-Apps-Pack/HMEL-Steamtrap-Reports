import { Badge } from '@faclon-labs/design-sdk';
import { classifyStatus, type StatusColumn } from '../lib/statusClassification';

type BadgeColor = 'Positive' | 'Negative' | 'Notice' | 'Information' | 'Neutral' | 'Primary';

const STATUS_COLOR: Record<StatusColumn, BadgeColor> = {
  Normal: 'Positive',
  'Mild Flooding': 'Notice',
  'Heavy Flooding': 'Negative',
  'Mild Leak': 'Notice',
  'Heavy Leak': 'Negative',
  Choking: 'Negative',
  'Valve Closed': 'Neutral',
  'No Status': 'Neutral',
  Offline: 'Neutral',
};

interface StatusBadgeProps {
  value: number | string | undefined;
}

export function StatusBadge({ value }: StatusBadgeProps) {
  const status = classifyStatus(value);
  return <Badge size="Small" color={STATUS_COLOR[status]} label={status} />;
}
