/** Layout intent only; selection and domain state stay in their existing owners. */
import { useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon.js'
import { useI18n } from '../i18n.js'

export function WorkbenchSplit({ selectionKey, children, detail }: {
  selectionKey: string | null
  children: ReactNode
  detail: ReactNode
}): JSX.Element {
  const { t } = useI18n()
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const detailActive = selectionKey !== null && dismissedKey !== selectionKey
  const browse = useRef<HTMLDivElement>(null)
  return (
    <div className="wb-split" data-detail-active={detailActive ? '1' : '0'} data-has-selection={selectionKey !== null ? '1' : '0'}>
      <div className="wb-nav" ref={browse} tabIndex={-1} aria-label={t('浏览内容')}>
        {selectionKey !== null && <button type="button" className="wb-btn wb-detail-reopen" onClick={() => setDismissedKey(null)}>{t('查看详情')}<Icon name="chevron" /></button>}
        {children}
      </div>
      <section className="wb-detail" aria-label={t('详情')}>
        <div className="wb-detail-heading">
          <button type="button" className="wb-btn wb-detail-back" onClick={() => { setDismissedKey(selectionKey); browse.current?.focus() }}><Icon name="back" />{t('返回列表')}</button>
          <span>{t('详情')}</span>
        </div>
        {detail}
      </section>
    </div>
  )
}
