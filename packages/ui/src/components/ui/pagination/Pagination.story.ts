import { defineComponent, h, ref } from 'vue'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationNext, PaginationPrevious } from '.'

// 100 items by 10: enough pages for the list to collapse into ellipses. The story holds the
// current page (the component is controlled) and records it for the test.
export const Stateful = defineComponent((props: { startPage?: number }) => {
  const page = ref(props.startPage ?? 1)
  return () => [
    h(Pagination, {
      'total': 100,
      'itemsPerPage': 10,
      'page': page.value,
      'siblingCount': 1,
      'showEdges': true,
      'onUpdate:page': (next: number) => (page.value = next),
    }, {
      default: () => h(PaginationContent, null, {
        default: ({ items }: { items: ({ type: 'page', value: number } | { type: 'ellipsis' })[] }) => [
          h(PaginationPrevious),
          ...items.map((item, i) => item.type === 'page'
            ? h(PaginationItem, { key: i, value: item.value, isActive: item.value === page.value }, () => String(item.value))
            : h(PaginationEllipsis, { key: i, index: i })),
          h(PaginationNext),
        ],
      }),
    }),
    h('output', { 'data-testid': 'page' }, String(page.value)),
  ]
}, { props: ['startPage'] })
