// Question-mark icon with an explanatory tooltip

import { HelpCircle } from 'lucide-react'

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} onClick={e => e.stopPropagation()}>
      <HelpCircle size={11} />
    </span>
  )
}

export default HelpTip
