# sherpa-onnx: its native library reads the Kotlin config classes' fields by name
# (JNI), so R8 must not rename or remove anything in the package.
-keep class com.k2fsa.sherpa.onnx.** { *; }
