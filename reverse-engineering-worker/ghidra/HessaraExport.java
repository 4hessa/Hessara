// HESSARA bounded headless export. Executed only inside a network-none job container.
// @category HESSARA
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.*;
import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

public class HessaraExport extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 3 || !args[0].equals("/work/ghidra.json")) {
            throw new IllegalArgumentException("Fixed bounded export destination is required");
        }
        int limit = Math.min(400, Math.max(1, Integer.parseInt(args[1])));
        boolean decompile = Boolean.parseBoolean(args[2]);
        JsonObject root = new JsonObject();
        JsonObject metadata = new JsonObject();
        metadata.addProperty("program", currentProgram.getName());
        metadata.addProperty("format", currentProgram.getExecutableFormat());
        metadata.addProperty("language", currentProgram.getLanguageID().toString());
        metadata.addProperty("compiler", currentProgram.getCompilerSpec().getCompilerSpecID().toString());
        metadata.addProperty("imageBase", currentProgram.getImageBase().toString());
        root.add("metadata", metadata);
        JsonArray functions = new JsonArray(), files = new JsonArray(), strings = new JsonArray();
        JsonArray deps = new JsonArray(), limitations = new JsonArray();
        DecompInterface decompiler = new DecompInterface();
        int count = 0, sourceCount = 0, failed = 0;
        if (decompile && !decompiler.openProgram(currentProgram)) {
            limitations.add("Decompiler could not open the program; source unavailable.");
            decompile = false;
        }
        try {
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && count < limit && !monitor.isCancelled()) {
                Function function = iterator.next();
                JsonObject record = new JsonObject();
                record.addProperty("name", function.getName());
                record.addProperty("address", function.getEntryPoint().toString());
                record.addProperty("size", function.getBody().getNumAddresses());
                record.addProperty("signature", function.getSignature().toString());
                functions.add(record);
                count++;
                if (decompile && sourceCount < 40) {
                    DecompileResults decoded = decompiler.decompileFunction(function, 3, monitor);
                    if (decoded.decompileCompleted() && decoded.getDecompiledFunction() != null) {
                        String source = decoded.getDecompiledFunction().getC();
                        JsonObject file = new JsonObject();
                        file.addProperty("path", "functions/" + function.getEntryPoint().toString().replace(':', '_') + ".c");
                        file.addProperty("language", "c");
                        file.addProperty("content", source.substring(0, Math.min(source.length(), 8000)));
                        file.addProperty("truncated", source.length() > 8000);
                        files.add(file);
                        sourceCount++;
                    } else { failed++; }
                }
            }
            if (iterator.hasNext()) limitations.add("Function inventory was limited to " + limit + " functions.");
            limitations.add("At most 40 functions are decompiled, 3 seconds per function and 8000 characters per source view.");
            if (failed > 0) limitations.add(failed + " function decompilations failed or timed out; source remains unknown.");
            DataIterator data = currentProgram.getListing().getDefinedData(true);
            while (data.hasNext() && strings.size() < 1000 && !monitor.isCancelled()) {
                Data item = data.next();
                Object value = item.getValue();
                if (value instanceof String) {
                    String text = (String)value;
                    JsonObject record = new JsonObject();
                    record.addProperty("address", item.getAddress().toString());
                    record.addProperty("value", text.substring(0, Math.min(text.length(), 1000)));
                    strings.add(record);
                }
            }
            for (String name : currentProgram.getExternalManager().getExternalLibraryNames()) {
                if (deps.size() >= 1000) break;
                JsonObject record = new JsonObject();
                record.addProperty("name", name);
                record.addProperty("kind", "external-library");
                deps.add(record);
            }
            root.add("functions", functions); root.add("files", files); root.add("strings", strings);
            root.add("dependencies", deps); root.add("limitations", limitations);
            Files.writeString(Path.of(args[0]), new Gson().toJson(root), StandardCharsets.UTF_8,
                              StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } finally { decompiler.dispose(); }
    }
}
