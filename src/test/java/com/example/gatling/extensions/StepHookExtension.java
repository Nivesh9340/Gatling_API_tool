package com.example.gatling.extensions;

import com.example.gatling.config.ConfigModels;
import io.gatling.javaapi.core.Session;

public interface StepHookExtension {
    default Session before(Session session, ConfigModels.RequestStep step) {
        return session;
    }

    default Session after(Session session, ConfigModels.RequestStep step) {
        return session;
    }
}

