import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/theme';
import { toIsoDate, isTemplateApplicableOnDate, useMealStore } from '@/store/useMealStore';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns the 7 dates (Mon–Sun) for the week containing `isoDate`. */
function getWeekDays(isoDate: string): Date[] {
  const date   = new Date(isoDate + 'T00:00:00');
  const day    = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

interface WeekStripProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export function WeekStrip({ selectedDate, onSelectDate }: WeekStripProps) {
  const todayIso  = toIsoDate(new Date());
  const logs      = useMealStore(s => s.logs);
  const templates = useMealStore(s => s.templates);

  // Strip always follows the week containing the VIEWED date (selectedDate)
  const weekDays = getWeekDays(selectedDate);

  /** Gray dot: day has applicable templates scheduled. */
  const hasTemplates = (iso: string): boolean =>
    templates.some(t => isTemplateApplicableOnDate(t, iso));

  /** Green dot: day has at least one completed meal. */
  const hasCompleted = (iso: string): boolean =>
    !!(logs[iso]?.meals.some(m => m.status === 'completed'));

  return (
    <View style={styles.container}>
      {weekDays.map(date => {
        const iso        = toIsoDate(date);
        const isToday    = iso === todayIso;
        // Selected = currently viewing this date, but it's not today
        const isSelected = iso === selectedDate && !isToday;
        const dotGreen   = hasCompleted(iso);
        const dotGray    = !dotGreen && hasTemplates(iso);

        return (
          <TouchableOpacity
            key={iso}
            onPress={() => onSelectDate(iso)}
            style={styles.cell}
            activeOpacity={0.7}
          >
            {/* Day label — green only on TODAY */}
            <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
              {SHORT_DAYS[date.getDay()]}
            </Text>

            {/* Dot — green = completed, gray = scheduled */}
            <View style={styles.dotSlot}>
              {dotGreen && <View style={styles.dotGreen} />}
              {dotGray  && <View style={styles.dotGray}  />}
            </View>

            {/* Date number — green on today, faint green pill bg when selected */}
            <View style={[styles.dateNumWrap, isSelected && styles.dateNumWrapSelected]}>
              <Text style={[styles.dateNum, isToday && styles.dateNumToday]}>
                {date.getDate()}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },

  // Day label
  dayLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  dayLabelToday: {
    color: COLORS.green,
    fontWeight: '600',
  },

  // Dot slot
  dotSlot: {
    height: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGreen: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.green,
  },
  dotGray: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.textMuted,
  },

  // Date number wrapper — used for the selected-date pill background
  dateNumWrap: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNumWrapSelected: {
    backgroundColor: COLORS.green + '25',
  },
  dateNum: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  dateNumToday: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.green,
  },
});
