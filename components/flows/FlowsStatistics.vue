<template>
  <div>
    <!-- 统计条：单一表面 + 分隔线，金额用等宽数字与语义色 -->
    <div
      class="grid grid-cols-2 md:grid-cols-4 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/5 dark:border-white/[0.06] shadow-sm overflow-hidden divide-x divide-y md:divide-y-0 divide-black/5 dark:divide-white/[0.06]"
    >
      <div class="flex items-center gap-3 px-3 py-2.5 md:px-5 md:py-4">
        <div
          class="hidden md:flex w-9 h-9 rounded-full items-center justify-center bg-emerald-500/10"
        >
          <ArrowTrendingUpIcon class="w-5 h-5 text-emerald-500" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] md:text-xs text-slate-500 dark:text-slate-400">
            总收入
          </p>
          <p
            class="text-sm md:text-xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 truncate"
          >
            {{ Number(statistics?.totalIn || 0).toFixed(2) }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 px-3 py-2.5 md:px-5 md:py-4">
        <div
          class="hidden md:flex w-9 h-9 rounded-full items-center justify-center bg-rose-500/10"
        >
          <ArrowTrendingDownIcon class="w-5 h-5 text-rose-500" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] md:text-xs text-slate-500 dark:text-slate-400">
            总支出
          </p>
          <p
            class="text-sm md:text-xl font-semibold tabular-nums tracking-tight text-rose-600 dark:text-rose-400 truncate"
          >
            {{ Number(statistics?.totalOut || 0).toFixed(2) }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 px-3 py-2.5 md:px-5 md:py-4">
        <div
          class="hidden md:flex w-9 h-9 rounded-full items-center justify-center bg-slate-500/10"
        >
          <ScaleIcon class="w-5 h-5 text-slate-500 dark:text-slate-300" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] md:text-xs text-slate-500 dark:text-slate-400">
            净收入
          </p>
          <p
            class="text-sm md:text-xl font-semibold tabular-nums tracking-tight truncate"
            :class="
              netIncome >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            "
          >
            {{ netIncome.toFixed(2) }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 px-3 py-2.5 md:px-5 md:py-4">
        <div
          class="hidden md:flex w-9 h-9 rounded-full items-center justify-center bg-slate-500/10"
        >
          <MinusCircleIcon class="w-5 h-5 text-slate-400" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] md:text-xs text-slate-500 dark:text-slate-400">
            不计收支
          </p>
          <p
            class="text-sm md:text-xl font-semibold tabular-nums tracking-tight text-slate-500 dark:text-slate-300 truncate"
          >
            {{ Number(statistics?.notInOut || 0).toFixed(2) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ScaleIcon,
  MinusCircleIcon,
} from "@heroicons/vue/24/outline";

interface Statistics {
  totalIn?: number;
  totalOut?: number;
  notInOut?: number;
}

interface Props {
  statistics?: Statistics;
}

const props = defineProps<Props>();

const netIncome = computed(
  () =>
    Number(props.statistics?.totalIn || 0) -
    Number(props.statistics?.totalOut || 0)
);
</script>
