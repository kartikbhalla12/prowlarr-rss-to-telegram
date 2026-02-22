#!/bin/bash

# Load environment variables (line-by-line so values with * or spaces are not expanded)
if [ -f .env ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        [[ $line =~ ^#.*$ ]] && continue
        [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
        export "$line"
    done < .env
else
    echo "Error: .env file not found"
    exit 1
fi

# Set variables
TAG="latest"

# Build the Docker image with multi-platform support
echo "Building Docker image..."
docker buildx use multi-platform-builder 2>/dev/null || docker buildx create --use --name multi-platform-builder
docker buildx build --platform linux/amd64,linux/arm64 --tag ${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:${TAG} --push .

# Image is already pushed by buildx with --push flag
echo "Image built and pushed with multi-platform support"

echo "Build and push completed successfully!" 