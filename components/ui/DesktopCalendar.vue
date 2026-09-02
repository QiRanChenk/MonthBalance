<template>
  <div class="w-full">
    <!-- Calendar Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-black/5 dark:border-white/[0.06]"
    >
      <!-- Navigation -->
      <div class="flex items-center gap-2">
        <button
          @click="prevMonth"
          class="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-200"
        >
          <ChevronLeftIcon class="w-5 h-5" />
        </button>

        <h2
          class="text-lg font-semibold min-w-36 text-center tracking-tight text-slate-800 dark:text-slate-100"
        >
          {{ currentMonthText }}
        </h2>

        <button
          @click="nextMonth"
          class="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-200"
        >
          <ChevronRightIcon class="w-5 h-5" />
        </button>
      </div>

      <!-- Analysis Button -->
      <button
        @click="showAnalysis"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-200 text-sm font-medium"
      >
        <ChartBarIcon class="w-4 h-4" />
        当月分析
      </button>
    </div>

    <!-- Weekday Headers -->
    <div
      class="grid grid-cols-7 border-b border-black/5 dark:border-white/[0.06]"
    >
      <div
        v-for="day in weekdays"
        :key="day"
        class="py-3 text-center text-xs font-medium text-slate-400 dark:text-slate-500 tracking-wide"
      >
        {{ day }}
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="grid grid-cols-7">
      <div
        v-for="date in calendarDates"
        :key="date.key"
        class="min-h-32 p-3 flex flex-col relative transition-colors duration-200 border-b border-r border-black/5 dark:border-white/[0.04] [&:nth-child(7n)]:border-r-0 hover:bg-emerald-50/40 dark:hover:bg-white/[0.03] group"
        :class="{
          'opacity-40': !date.isCurrentMonth,
          'bg-emerald-500/[0.07]': date.isToday,
        }"
      >
        <!-- Date and Add Button -->
        <div class="flex justify-between items-start mb-2">
          <span
            class="text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full"
            :class="{
              'bg-emerald-600 text-white font-semibold': date.isToday,
              'text-slate-700 dark:text-slate-200':
                date.isCurrentMonth && !date.isToday,
              'text-slate-400 dark:text-slate-600': !date.isCurrentMonth,
            }"
          >
            {{ date.day }}
          </span>
          <button
            v-if="date.isCurrentMonth"
            @click="addFlow(date)"
            class="w-6 h-6 rounded-full text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 flex items-center justify-center transition-all duration-200 opacity-0 group-hover:opacity-100"
          >
            <PlusIcon class="w-4 h-4" />
          </button>
        </div>

        <!-- Flow Data -->
        <div v-if="date.isCurrentMonth" class="flex flex-col gap-1 flex-1">
          <!-- Expense -->
          <div
            v-if="getDateExpense(date.dateString)"
            @click="clickDay(date.dateString, '支出')"
            class="flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium tabular-nums cursor-pointer transition-colors duration-200"
            :class="getExpenseClass(getDateExpense(date.dateString))"
          >
            <span>支</span>
            <span>−{{ getDateExpense(date.dateString).toFixed(2) }}</span>
          </div>
          <!-- Income -->
          <div
            v-if="getDateIncome(date.dateString)"
            @click="clickDay(date.dateString, '收入')"
            class="flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium tabular-nums cursor-pointer transition-colors duration-200 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
          >
            <span>收</span>
            <span>+{{ getDateIncome(date.dateString).toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChartBarIcon,
} from "@heroicons/vue/24/outline";

interface CalendarDate {
  date: Date;
  dateString: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  key: string;
}

interface Props {
  currentDate: Date;
  incomeData: Record<string, number>;
  expenseData: Record<string, number>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "add-flow": [date: CalendarDate];
  "click-day": [dateString: string, flowType: string];
  "month-change": [date: Date];
  "show-analysis": [month: string];
}>();

const currentDate = ref(new Date(props.currentDate));

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

const currentMonthText = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth() + 1;
  return `${year} 年 ${month} 月`;
});

const calendarDates = computed((): CalendarDate[] => {
  const dates: CalendarDate[] = [];
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  // Get first day of month and calculate start of calendar
  const firstDay = new Date(year, month, 1);
  const startDay = new Date(firstDay);
  startDay.setDate(startDay.getDate() - firstDay.getDay());

  // Generate 42 days (6 weeks)
  for (let i = 0; i < 42; i++) {
    const date = new Date(startDay);
    date.setDate(startDay.getDate() + i);

    const isCurrentMonth = date.getMonth() === month;
    const isToday = isSameDay(date, new Date());
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    dates.push({
      date: new Date(date),
      dateString: formatDate(date),
      day: date.getDate(),
      isCurrentMonth,
      isToday,
      isWeekend,
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    });
  }

  return dates;
});

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const getDateIncome = (dateString: string): number => {
  return props.incomeData[dateString] || 0;
};

const getDateExpense = (dateString: string): number => {
  return props.expenseData[dateString] || 0;
};

// 支出强度用同一色相的深浅表达，避免红橙黄三色打架
const getExpenseClass = (amount: number): string => {
  if (!amount || amount === 0) {
    return "bg-black/5 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10";
  } else if (amount >= 1000) {
    return "bg-rose-500/25 text-rose-700 dark:text-rose-300 hover:bg-rose-500/35";
  } else if (amount >= 500) {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25";
  } else {
    return "bg-rose-500/[0.08] text-rose-600 dark:text-rose-400 hover:bg-rose-500/[0.16]";
  }
};

const prevMonth = () => {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() - 1,
    1
  );
  emit("month-change", currentDate.value);
};

const nextMonth = () => {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() + 1,
    1
  );
  emit("month-change", currentDate.value);
};

const addFlow = (date: CalendarDate) => {
  emit("add-flow", date);
};

const clickDay = (dateString: string, flowType: string) => {
  emit("click-day", dateString, flowType);
};

const showAnalysis = () => {
  emit("show-analysis", currentMonthText.value);
};

// Watch for prop changes
watch(
  () => props.currentDate,
  (newDate) => {
    currentDate.value = new Date(newDate);
  }
);
</script>
