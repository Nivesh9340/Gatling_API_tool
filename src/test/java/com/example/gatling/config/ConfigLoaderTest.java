package com.example.gatling.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConfigLoaderTest {

    @Test
    void loadsStepWithUrlQueryFormAndRequestFlags() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Search\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Search API\"\n"
                + "        method: \"POST\"\n"
                + "        url: \"https://example.com/v1/search\"\n"
                + "        bodyType: \"form\"\n"
                + "        queryParams:\n"
                + "          tenant: \"abc\"\n"
                + "        formParams:\n"
                + "          state: \"ACTIVE\"\n"
                + "        auth:\n"
                + "          type: \"header\"\n"
                + "          headerName: \"x-api-key\"\n"
                + "          headerValueEnv: \"API_KEY\"\n"
                + "        requestTimeoutMs: 1000\n"
                + "        disableFollowRedirect: true\n";

        ConfigModels.TestPlan plan = assertDoesNotThrow(() -> ConfigLoader.load(writeTempConfig(yaml).toString()));
        ConfigModels.RequestStep step = plan.scenarios.get(0).steps.get(0);
        assertEquals("https://example.com/v1/search", step.url);
        assertEquals("abc", step.queryParams.get("tenant"));
        assertEquals("ACTIVE", step.formParams.get("state"));
        assertEquals("header", step.auth.type);
        assertEquals(Integer.valueOf(1000), step.requestTimeoutMs);
        assertEquals(Boolean.TRUE, step.disableFollowRedirect);
    }

    @Test
    void rejectsBodyCombinedWithFormParams() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Invalid\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Bad Request\"\n"
                + "        method: \"POST\"\n"
                + "        path: \"/v1/resources\"\n"
                + "        body: '{\"ok\":true}'\n"
                + "        formParams:\n"
                + "          state: \"ACTIVE\"\n";

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> ConfigLoader.load(writeTempConfig(yaml).toString()));
        assertTrue(ex.getMessage().contains("cannot be combined with step.formParams"));
    }

    @Test
    void rejectsMultipartWithoutParamsOrUploads() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Upload\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Upload file\"\n"
                + "        method: \"POST\"\n"
                + "        path: \"/upload\"\n"
                + "        bodyType: \"multipart\"\n";

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> ConfigLoader.load(writeTempConfig(yaml).toString()));
        assertTrue(ex.getMessage().contains("requires formUploads or formParams"));
    }

    @Test
    void acceptsMultipartWithUploads() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Upload\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Upload file\"\n"
                + "        method: \"POST\"\n"
                + "        path: \"/upload\"\n"
                + "        bodyType: \"multipart\"\n"
                + "        formUploads:\n"
                + "          - fieldName: \"file\"\n"
                + "            filePath: \"src/test/resources/data/users.csv\"\n";

        assertDoesNotThrow(() -> ConfigLoader.load(writeTempConfig(yaml).toString()));
    }

    @Test
    void loadsMultiBranchConditionalStep() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Branching\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Lookup\"\n"
                + "        method: \"GET\"\n"
                + "        path: \"/lookup\"\n"
                + "        captures:\n"
                + "          - type: \"header\"\n"
                + "            path: \"x-route\"\n"
                + "            saveAs: \"routeType\"\n"
                + "      - name: \"Dispatch\"\n"
                + "        method: \"GET\"\n"
                + "        path: \"/default\"\n"
                + "        branches:\n"
                + "          - name: \"Premium\"\n"
                + "            when:\n"
                + "              variable: \"routeType\"\n"
                + "              operator: \"in\"\n"
                + "              values:\n"
                + "                - \"premium\"\n"
                + "                - \"vip\"\n"
                + "            path: \"/premium\"\n"
                + "          - name: \"Missing\"\n"
                + "            when:\n"
                + "              variable: \"routeType\"\n"
                + "              operator: \"notExists\"\n"
                + "            path: \"/missing\"\n"
                + "        fallback:\n"
                + "          path: \"/standard\"\n";

        ConfigModels.TestPlan plan = assertDoesNotThrow(() -> ConfigLoader.load(writeTempConfig(yaml).toString()));
        ConfigModels.RequestStep step = plan.scenarios.get(0).steps.get(1);
        assertEquals(2, step.branches.size());
        assertEquals("in", step.branches.get(0).when.operator);
        assertEquals("/standard", step.fallback.path);
    }

    @Test
    void rejectsConditionWithoutRequiredValueForEquals() throws IOException {
        String yaml = ""
                + "service:\n"
                + "  baseUrl: \"https://example.com\"\n"
                + "scenarios:\n"
                + "  - name: \"Invalid\"\n"
                + "    load:\n"
                + "      users: 1\n"
                + "      rampDurationSec: 1\n"
                + "    steps:\n"
                + "      - name: \"Dispatch\"\n"
                + "        method: \"GET\"\n"
                + "        path: \"/default\"\n"
                + "        branches:\n"
                + "          - when:\n"
                + "              variable: \"routeType\"\n"
                + "              operator: \"equals\"\n"
                + "            path: \"/premium\"\n";

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () -> ConfigLoader.load(writeTempConfig(yaml).toString()));
        assertTrue(ex.getMessage().contains("requires value/equals"));
    }

    private Path writeTempConfig(String yaml) throws IOException {
        Path path = Files.createTempFile("gatling-config", ".yaml");
        Files.writeString(path, yaml);
        path.toFile().deleteOnExit();
        return path;
    }
}
