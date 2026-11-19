package ai.guideband.app

import android.app.AlertDialog
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import ai.guideband.app.commands.CommandRouter

class ConfirmActivity : AppCompatActivity() {
    override fun onCreate(state: Bundle?) { super.onCreate(state); val command=intent.getStringExtra("command").orEmpty();AlertDialog.Builder(this).setTitle("GuideEye understood").setMessage(intent.getStringExtra("summary") ?: command).setNegativeButton("Cancel"){_,_->finish()}.setPositiveButton("Continue"){_,_->CommandRouter.executeConfirmed(this,command);finish()}.setOnCancelListener{finish()}.show() }
}
