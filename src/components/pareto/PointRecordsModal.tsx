import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { Play } from 'lucide-react'
import type { ParetoPoint } from './constants'
import { formatTick } from './ticks'

interface PointRecordsModalProps {
  x: number
  y: number
  records: ParetoPoint[]
  onClose: () => void
  onPlay: (point: ParetoPoint) => void
}

export function PointRecordsModal({ x, y, records, onClose, onPlay }: PointRecordsModalProps) {
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => { if (!open) onClose() }}
      width={540}
      purpose="info"
    >
      <DialogHeader
        title={`${records.length} record${records.length === 1 ? '' : 's'} at ${formatTick(x)} / ${formatTick(y)}`}
        subtitle="Select a solution with a replay to launch the interactive player."
        onOpenChange={(open) => { if (!open) onClose() }}
      />
      <VStack gap={2} padding={3} className="point-records-list">
        {records.map((p, pi) => {
          const label = p.isUser
            ? `${p.name ?? '(unnamed)'} — ${p.fullScore ?? `${p.x} / ${p.y}`}`
            : p.score || `${p.x} / ${p.y}`
          return (
            <HStack
              key={`${p.id}-${pi}`}
              justify="between"
              vAlign="center"
              gap={2}
              wrap="wrap"
              className="point-records-row"
            >
              <HStack gap={1.5} vAlign="center" wrap="wrap" className="point-records-main">
                <Text type="code" size="sm" hasTabularNumbers>
                  {label}
                </Text>
                {p.isUser && <Badge variant={p.green ? 'success' : 'error'} label="Yours" />}
                {p.categories && <Badge variant="info" label={p.categories} />}
              </HStack>
              {p.canPlay && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Play size={12} />}
                  label="Replay"
                  onClick={() => onPlay(p)}
                />
              )}
            </HStack>
          )
        })}
      </VStack>
    </Dialog>
  )
}
