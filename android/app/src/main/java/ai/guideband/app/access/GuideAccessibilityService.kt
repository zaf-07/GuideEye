package ai.guideband.app.access
import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class GuideAccessibilityService:AccessibilityService(){
    companion object{@Volatile var active=false}
    override fun onServiceConnected(){active=true;super.onServiceConnected()}
    override fun onAccessibilityEvent(event:AccessibilityEvent?){/* No passive harvesting. UI content is inspected only by a future explicit, allowlisted command. */}
    override fun onInterrupt(){}
    override fun onDestroy(){active=false;super.onDestroy()}
}
