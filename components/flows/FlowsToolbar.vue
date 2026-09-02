<template>
  <div
    class="flex flex-col gap-2 bg-white dark:bg-white/[0.04] rounded-2xl shadow-sm border border-black/5 dark:border-white/[0.06] p-2 md:p-3 mb-2 md:mb-4"
  >
    <!-- 第一行：主要操作按钮 - 桌面端水平排列，手机端垂直堆叠 -->
    <div class="flex flex-col md:flex-row md:justify-between gap-2">
      <div class="flex flex-wrap gap-2">
        <button @click="$emit('createNew')" class="btn-solid">
          <PlusIcon class="w-4 h-4" />
          新增
        </button>
        <button @click="$emit('openImportExport')" class="btn-ghost">
          <CloudArrowDownIcon class="w-4 h-4" />
          <span class="hidden sm:inline">导入导出</span>
          <span class="sm:hidden">导入</span>
        </button>
        <button @click="$emit('autoMerge')" class="btn-ghost">
          <AdjustmentsHorizontalIcon class="w-4 h-4" />
          <span class="hidden sm:inline">自助平账</span>
          <span class="sm:hidden">平账</span>
        </button>
        <button @click="$emit('autoDeduplication')" class="btn-ghost">
          <DocumentDuplicateIcon class="w-4 h-4" />
          <span class="hidden sm:inline">自助去重</span>
          <span class="sm:hidden">去重</span>
        </button>
      </div>

      <div class="flex flex-col sm:flex-row gap-2">
        <!-- 批量操作 - 有选中项时显示 -->
        <div v-if="selectedCount > 0" class="flex gap-2">
          <button
            @click="$emit('deleteSelected')"
            class="flex-1 sm:flex-none px-3 py-1.5 md:py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors duration-200 flex items-center justify-center gap-1.5 text-sm font-medium"
          >
            <TrashIcon class="w-4 h-4" />
            <span class="hidden sm:inline">删除选中({{ selectedCount }})</span>
            <span class="sm:hidden">删除({{ selectedCount }})</span>
          </button>
          <button @click="$emit('batchChangeType')" class="btn-ghost">
            <PencilSquareIcon class="w-4 h-4" />
            <span class="hidden sm:inline">类型修改({{ selectedCount }})</span>
            <span class="sm:hidden">修改({{ selectedCount }})</span>
          </button>
        </div>

        <!-- 筛选操作 -->
        <div class="flex gap-2">
          <button @click="$emit('openSearch')" class="btn-ghost">
            <FunnelIcon class="w-4 h-4" />
            筛选
          </button>
          <button @click="$emit('resetQuery')" class="btn-ghost">
            <ArrowPathIcon class="w-4 h-4" />
            重置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  CloudArrowDownIcon,
  AdjustmentsHorizontalIcon,
  DocumentDuplicateIcon,
  PlusIcon,
  FunnelIcon,
  ArrowPathIcon,
  TrashIcon,
  PencilSquareIcon,
} from "@heroicons/vue/24/outline";

interface Props {
  selectedCount: number;
}

defineProps<Props>();

defineEmits<{
  openImportExport: [];
  autoMerge: [];
  autoDeduplication: [];
  createNew: [];
  deleteSelected: [];
  batchChangeType: [];
  openSearch: [];
  resetQuery: [];
}>();
</script>

<style scoped>
.btn-solid {
  @apply flex-1 md:flex-none px-3 py-1.5 md:py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors duration-200 flex items-center justify-center gap-1.5 text-sm font-medium shadow-sm;
}
.btn-ghost {
  @apply flex-1 md:flex-none px-3 py-1.5 md:py-2 rounded-lg transition-colors duration-200 flex items-center justify-center gap-1.5 text-sm font-medium border border-black/10 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5;
}
</style>
