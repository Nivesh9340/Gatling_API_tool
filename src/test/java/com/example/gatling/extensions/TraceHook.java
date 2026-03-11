package com.example.gatling.extensions;

import com.example.gatling.config.ConfigModels;
import io.gatling.javaapi.core.Session;

public class TraceHook implements StepHookExtension {
    @Override
    public Session before(Session session, ConfigModels.RequestStep step) {
        return session.set("hook_step_name", step == null ? "" : step.name)
                .set("hook_start_ms", System.currentTimeMillis());
    }

    @Override
    public Session after(Session session, ConfigModels.RequestStep step) {
        Object started = session.get("hook_start_ms");
        long startMs = started instanceof Number ? ((Number) started).longValue() : System.currentTimeMillis();
        return session.set("hook_elapsed_ms", Math.max(0L, System.currentTimeMillis() - startMs));
    }
}

