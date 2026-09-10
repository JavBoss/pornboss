import { useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AppModal from '@/components/AppModal'
import DownloaderSettingsView from '@/components/DownloaderSettingsView'
import DownloadsView from '@/components/DownloadsView'
import { zh } from '@/utils/i18n'

const tabs = [
  { id: 'jobs', label: zh('下载任务', 'Downloads') },
  {
    id: 'settings',
    label: zh('下载设置', 'Download settings'),
  },
]

export default function DownloadView({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('jobs')

  if (!open) return null

  return (
    <AppModal
      open={open}
      onClose={onClose}
      ariaLabel={zh('下载', 'Downloads')}
      className="p-3 sm:p-6"
      contentClassName="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div
          className="flex min-w-0 gap-1 overflow-x-auto"
          role="tablist"
          aria-label={zh('下载页面导航', 'Download navigation')}
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="download-tab-panel"
                onClick={() => setActiveTab(tab.id)}
                className={`min-w-max rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  selected
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('关闭下载弹窗', 'Close downloads dialog')}
          title={zh('关闭', 'Close')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <CloseRoundedIcon fontSize="small" />
        </button>
      </header>

      <main
        id="download-tab-panel"
        role="tabpanel"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {activeTab === 'settings' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-5 sm:pb-5 sm:pt-3">
            <DownloaderSettingsView />
          </div>
        ) : (
          <DownloadsView />
        )}
      </main>
    </AppModal>
  )
}
